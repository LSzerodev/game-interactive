// Fila de acoes do personagem: uma de cada vez, maior prioridade primeiro.
//   speech: resposta em CHUNKS (frases). A IA escreve, a voz sintetiza e o jogo
//           toca em paralelo: o primeiro chunk ja fala enquanto o resto ainda
//           esta sendo sintetizado.
//   dance : Godot toca a musica e dança -> espera "dance_finished"
// Nada corta uma acao no meio: um presente que chega durante uma fala entra
// na frente da fila e acontece assim que a fala termina.
//
// Voz clonada na CPU gera audio MAIS DEVAGAR do que ele toca (XTTS ~2,2 s de
// calculo por 1 s de fala). Tocar cada chunk assim que sai deixaria silencios
// longos no meio da resposta. Por isso a fala so comeca quando, pelas estimativas,
// nenhuma pausa entre chunks passaria de SPEECH_MAX_GAP_SECONDS (padrao 4 s). 0 = nunca ter pausa (comeca mais tarde); 999 = toca cada
// chunk assim que fica pronto. Com voz rapida (voz do Windows, GPU) nao segura nada.
const bridge = require('./bridge');
const tts = require('./tts');
const cfg = require('./config');
const log = require('./log');
const { analyzeWav } = require('./lipsync');

// Comentarios ficam na frente das boas-vindas: responder quem esta conversando vale mais
// do que saudar quem acabou de entrar.
const PRIORITY = { dance: 90, thanks: 80, top_comment: 70, comment: 65, welcome: 40 };
// Idade maxima na fila. Uma resposta falada depois disso ja nao faz sentido (a conversa
// andou), entao e descartada com um aviso no log em vez de atrasar quem vem depois.
const MAX_AGE_MS = { welcome: 25000, thanks: 120000, comment: 150000 };
const MAX_PENDING_DANCES = 3;
// lido a cada uso: o painel pode mudar com a live rodando
const maxGap = () => cfg.SPEECH_MAX_GAP_SECONDS;
// Chunks sintetizados esperando a vez. O texto da resposta inteira precisa ser
// conhecido para estimar o tempo (a IA escreve bem mais rapido que a voz fala).
const MAX_BUFFERED_CHUNKS = 6;
const PREFETCH_AHEAD = 1; // proxima fala da fila que ja comeca a ser gerada

// Estimativas, atualizadas a cada sintese (media movel):
//   synth  = segundos de calculo por segundo de audio gerado
//   perChar = segundos de audio por caractere de texto
const INITIAL_SYNTH_RATE = { xtts: 2.2, chatterbox: 7, openai: 0.4, gemini: 0.5, elevenlabs: 0.3, sapi: 0.15 };
const rates = { synth: INITIAL_SYNTH_RATE[cfg.TTS_PROVIDER] ?? 1, perChar: 0.08 };

let seq = 0;
const pending = [];
let running = false;
let current = null;

function push(job) {
  pending.push(job);
  pending.sort((a, b) => b.priority - a.priority || a.order - b.order);
  prefetch();
  pump();
  return job;
}

// makeSource() devolve um async iterable de strings (chunks de fala).
function enqueueStream(makeSource, { priority = PRIORITY.comment, metadata = {} } = {}) {
  return push({ kind: 'speech', id: `speech-${Date.now()}-${++seq}`, makeSource, priority, metadata, order: seq, createdAt: Date.now() });
}

function enqueue(text, opts = {}) {
  return enqueueStream(async function* () {
    yield text;
  }, opts);
}

function enqueueDance(dance, metadata = {}) {
  const dances = pending.filter((j) => j.kind === 'dance').length;
  if (dances >= MAX_PENDING_DANCES) return null; // rajada de presentes: descarta excesso
  return push({ kind: 'dance', id: `dance-${Date.now()}-${++seq}`, dance, priority: PRIORITY.dance, metadata, order: seq });
}

// ------------------------------------------------------------ pipeline

// A voz atende uma sintese por vez: todas as sinteses passam por esta cadeia.
let synthChain = Promise.resolve();
function synthesize(text) {
  const run = synthChain.then(async () => {
    const t0 = Date.now();
    try {
      const file = await tts.synthesize(text);
      const lip = analyzeWav(file);
      const wall = (Date.now() - t0) / 1000;
      log.info('voz', `${lip.duration.toFixed(1)} s de áudio gerados em ${wall.toFixed(1)} s: "${text.slice(0, 60)}"`);
      // chunks muito curtos ("haha!") tem custo fixo alto e duracao imprevisivel: nao entram na media
      if (lip.duration > 1.5 && text.length >= 15) {
        rates.synth = 0.6 * rates.synth + 0.4 * (wall / lip.duration);
        rates.perChar = 0.7 * rates.perChar + 0.3 * Math.min(0.13, lip.duration / text.length);
      }
      return { file, lip, text };
    } catch (e) {
      log.error('voz', `a síntese falhou (${e.message}): "${text.slice(0, 50)}"`);
      return null;
    }
  });
  synthChain = run.catch(() => {});
  return run;
}

// Inicia (uma vez) o produtor: le os chunks da IA e manda sintetizar cada um.
function start(job) {
  if (job.pipe) return job.pipe;
  const pipe = { items: [], consumed: 0, done: false, waiters: [], startedAt: Date.now() };
  const wake = () => pipe.waiters.splice(0).forEach((f) => f());
  pipe.wait = () => new Promise((r) => pipe.waiters.push(r));
  pipe.wake = wake;
  (async () => {
    try {
      for await (const text of job.makeSource()) {
        // contrapressao: nao sintetiza muito a frente do que esta tocando
        while (pipe.items.length - pipe.consumed >= MAX_BUFFERED_CHUNKS) await pipe.wait();
        pipe.items.push({ text, ready: synthesize(text) });
        wake();
      }
    } catch (e) {
      log.error('ia', `erro ao gerar a resposta (${e.message})`);
    } finally {
      pipe.done = true;
      wake();
    }
  })();
  job.pipe = pipe;
  return pipe;
}

function prefetch() {
  pending.filter((j) => j.kind === 'speech').slice(0, PREFETCH_AHEAD).forEach(start);
}

function waitFor(type, id, maxSeconds) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      bridge.off(type, onMsg);
      bridge.off('disconnected', done);
      resolve();
    };
    const onMsg = (msg) => {
      if (msg.job_id === id) done();
    };
    const timer = setTimeout(() => {
      log.warn('jogo', `o jogo não confirmou o fim de ${id} em ${Math.round(maxSeconds)} s (segui em frente)`);
      done();
    }, maxSeconds * 1000);
    bridge.on(type, onMsg);
    bridge.on('disconnected', done);
  });
}

async function untilConnected() {
  while (!bridge.connected) await new Promise((r) => setTimeout(r, 500));
}

// Da para comecar a falar agora sem ficar em silencio no meio? `held` = chunks
// prontos (tocam primeiro); `rest` = textos dos que ainda estao sendo gerados.
function canStartSmoothly(held, rest, limit = maxGap()) {
  let playEnd = held.reduce((s, c) => s + c.lip.duration, 0); // quando o audio garantido acaba (relogio: agora = 0)
  let ready = 0; // quando o chunk k fica pronto
  for (const item of rest) {
    const dur = item.text.length * rates.perChar; // duracao estimada do chunk k
    ready += dur * rates.synth;
    const gap = ready - playEnd; // silencio antes do chunk k
    if (gap > limit) return false;
    playEnd = Math.max(playEnd, ready) + dur;
  }
  return true;
}

// Cada chunk vai ao Godot assim que pode: o jogo enfileira e emenda os audios
// sem intervalo (nenhuma ida e volta com o servidor entre um chunk e outro).
async function runSpeech(job) {
  const pipe = start(job);
  const who = job.metadata.display_name ? ` para ${job.metadata.display_name}` : '';
  log.info('fala', `na vez: ${job.metadata.kind || 'fala'}${who}`);
  // O comentario aparece na tela NA HORA (a voz leva varios segundos para ficar pronta)
  if (job.metadata.kind === 'comment') {
    bridge.send({
      type: 'comment_show',
      payload: { display_name: job.metadata.display_name, text: job.metadata.in_reply_to, avatar_url: job.metadata.avatar_url },
    });
  }
  const finishes = [];
  const held = [];
  let started = maxGap() >= 999;
  let queuedSeconds = 0;
  let index = 0;

  const send = async (c, i) => {
    await untilConnected();
    const chunkId = `${job.id}#${i}`;
    log.ok('fala', `${i === 0 ? `começou a falar após ${((Date.now() - pipe.startedAt) / 1000).toFixed(1)} s` : `frase ${i + 1}`}: "${c.text}"`);
    bridge.send({
      type: 'speech_ready',
      payload: {
        job_id: chunkId,
        text: c.text,
        audio_path: c.file,
        envelope: c.lip.envelope,
        hop: c.lip.hop,
        segments: c.lip.segments,
        timeline_end: c.lip.duration,
        speech_end: c.lip.speechEnd,
        // ainda vem mais frases? (o jogo mostra "pensando..." na pausa ate a proxima chegar)
        metadata: { ...job.metadata, chunk_index: i, more: !pipe.done || i + 1 < pipe.items.length },
      },
    });
    queuedSeconds += c.lip.duration;
    finishes.push(waitFor('speech_finished', chunkId, queuedSeconds + 10));
  };
  const flush = async () => {
    for (const c of held.splice(0)) await send(c, c.index);
  };

  for (;;) {
    while (index >= pipe.items.length && !pipe.done) await pipe.wait();
    if (index >= pipe.items.length) break;
    const item = pipe.items[index];
    const ready = await item.ready;
    pipe.consumed = index + 1;
    pipe.wake();
    if (ready) held.push({ ...ready, index });
    index += 1;
    if (!started && held.length) started = canStartSmoothly(held, pipe.items.slice(index));
    if (started) await flush();
  }
  await flush(); // resposta inteira pronta: toca o que sobrou
  if (!finishes.length) log.warn('fala', `nenhuma frase foi falada${who} (a IA ou a voz não gerou nada)`);
  bridge.send({ type: 'thinking_end' }); // garante que o "pensando..." some mesmo se nada foi falado
  await Promise.all(finishes);
}

async function runDance(job) {
  await untilConnected();
  log.ok('dança', `iniciando ${job.dance} (${job.metadata.display_name || ''} mandou ${job.metadata.gift_name || ''})`);
  bridge.send({ type: 'dance_start', payload: { job_id: job.id, dance: job.dance, max_seconds: 20, ...job.metadata } });
  await waitFor('dance_finished', job.id, 26);
  log.info('dança', `${job.dance} terminou`);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      current = pending.shift();
      const maxAge = current.kind === 'speech' ? MAX_AGE_MS[current.metadata.kind] : undefined;
      if (maxAge && Date.now() - current.createdAt > maxAge) {
        log.warn('fala', `descartei ${current.metadata.kind} de ${current.metadata.display_name || '?'}: esperou ${Math.round((Date.now() - current.createdAt) / 1000)} s na fila (limite ${maxAge / 1000} s)`);
        current = null;
        continue;
      }
      prefetch(); // a proxima fala comeca a ser gerada enquanto esta toca
      await (current.kind === 'dance' ? runDance(current) : runSpeech(current));
      current = null;
    }
  } finally {
    running = false;
  }
}

const status = () => ({
  pending: pending.length,
  busy: !!current,
  current: current && `${current.kind}:${current.id}`,
  queue: pending.map((j) => `${j.kind}:${j.kind === 'dance' ? j.dance : j.id}`),
  rates: { synth: +rates.synth.toFixed(2), perChar: +rates.perChar.toFixed(3), maxGap: maxGap() },
});

// o painel trocou a voz: as estimativas de velocidade da voz anterior nao valem mais
const resetRates = () => {
  rates.synth = INITIAL_SYNTH_RATE[cfg.TTS_PROVIDER] ?? 1;
};

module.exports = { enqueue, enqueueStream, enqueueDance, status, PRIORITY, canStartSmoothly, rates, resetRates };
