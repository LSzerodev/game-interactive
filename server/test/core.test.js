const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OLLAMA_URL = 'http://127.0.0.1:9'; // Ollama inexistente: testa os caminhos de reserva
const gifts = require('../src/gifts');
const ai = require('../src/ai');
const { analyzeWav } = require('../src/lipsync');
const tts = require('../src/tts');

function writeWav(file, parts, rate = 22050) {
  const samples = [];
  for (const [dur, amp] of parts) {
    for (let i = 0; i < dur * rate; i++) samples.push(Math.round(amp * Math.sin((2 * Math.PI * 200 * i) / rate)));
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

test('lipsync: boca abre na fala e fecha na pausa', () => {
  const f = path.join(os.tmpdir(), `lip_${Date.now()}.wav`);
  writeWav(f, [[0.3, 0], [0.5, 12000], [0.4, 0], [0.4, 8000]]);
  const r = analyzeWav(f);
  fs.rmSync(f);
  const at = (t) => r.envelope[Math.floor(t / r.hop)];
  assert.ok(at(0.1) < 0.05);
  assert.ok(at(0.55) > 0.5);
  assert.ok(at(1.0) < 0.2);
});

test('presentes: Tiny Diny e dinossauro dançam o Jamal', () => {
  for (const n of ['Tiny Diny', 'TinyDiny', 'tiny-diny', 'Dinosaur', 'Dinossauro']) {
    const a = gifts.actionFor(n);
    assert.strictEqual(a.action, 'dance', n);
    assert.strictEqual(a.dance, 'jamal', n);
  }
});

test('presentes: Donut dança ConfidenceHolic, Rosa só agradece', () => {
  for (const n of ['Doughnut', 'Donut']) assert.strictEqual(gifts.actionFor(n).dance, 'confidenceholic');
  for (const n of ['Rose', 'Rosa']) assert.strictEqual(gifts.actionFor(n).action, 'thanks_rose');
  assert.strictEqual(gifts.actionFor('Galaxy').action, 'other');
});

const collect = async (gen) => {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
};

test('falas: cumprimento, rosa e boas-vindas citam o nome (Ollama fora do ar)', async () => {
  assert.strictEqual(ai.greeting('Maria', 'oi, tudo bem?'), 'Oi Maria, tudo bem com você também?');
  assert.deepStrictEqual(await collect(ai.welcomeStream(['Ana'])), ['Fala, Ana, seja bem-vindo!']);
  assert.deepStrictEqual(await collect(ai.welcomeStream(['Ana', 'Bia', 'Caio'])), ['Fala, Ana, Bia e Caio!', 'Sejam bem-vindos!']);
  const rosa = (await collect(ai.thanksRoseStream('Ana'))).join(' ');
  assert.match(rosa, /Ana/);
  assert.match(rosa, /rosa/i);
});

test('resposta a comentario: cumprimento sai em 1 chunk; sem Ollama usa frase pronta com o nome', async () => {
  assert.deepStrictEqual(await collect(ai.replyStream('u1', 'Maria', 'oi, tudo bem?')), ['Oi Maria, tudo bem com você também?']);
  const r = await collect(ai.replyStream('u2', 'Leo', 'qual seu jogo favorito?'));
  assert.strictEqual(r.length, 1);
  assert.match(r[0], /Leo/);
});

test('chunks: primeira frase sai logo, ações e emojis não são falados, Dr. não corta', () => {
  assert.deepStrictEqual(ai.splitChunks('Opa, e aí! Sonic na área, bora correr? Qual é a boa de hoje, campeão?'), [
    'Opa, e aí! Sonic na área,',
    'bora correr? Qual é a boa de hoje, campeão?',
  ]);
  assert.deepStrictEqual(ai.splitChunks('*bate o pé no chão* Ah, qual é, tá demorando demais! Mais rápido que isso só eu. ⚡💨'), [
    'Ah, qual é, tá demorando demais!',
    'Mais rápido que isso só eu.',
  ]);
  assert.deepStrictEqual(ai.splitChunks('O Dr. Eggman aprontou de novo, mas eu dei um jeito nele.'), ['O Dr. Eggman aprontou de novo,', 'mas eu dei um jeito nele.']);
});

test('chunks: streaming em pedaços pequenos dá o mesmo resultado e espera a ação fechar', () => {
  const texto = 'Haha, bela tentativa! Mas eu sou o Sonic e só sei ser o Sonic. *sorri de canto* Que tal uma corrida em vez disso?';
  const c = ai.createChunker();
  const out = [];
  for (const d of texto.match(/.{1,4}/g)) out.push(...c.push(d));
  out.push(...c.end());
  assert.deepStrictEqual(out, ['Haha, bela tentativa! Mas eu sou o Sonic e só sei ser o Sonic.', 'Que tal uma corrida em vez disso?']);
});

test('persona: o prompt do Sonic é carregado e as regras de voz são somadas', () => {
  const p = ai.systemPrompt();
  assert.match(p, /Sonic the Hedgehog/);
  assert.match(p, /REGRAS DESTA TRANSMISSÃO/);
  assert.match(p, /Chili dogs|chili dogs/);
});

test('comentario bloqueado e filtrado, mas *acao* nao conta como bloqueio', () => {
  assert.strictEqual(ai.isBlocked('isso e uma merda'), true);
  assert.strictEqual(ai.isBlocked('*oi*'), false);
  assert.strictEqual(ai.speakableName('🔥Ana__Luz🔥'), 'Ana Luz');
});

test('ia: limpa a saída do modelo', () => {
  assert.strictEqual(ai.sanitize('<think>hmm</think>Resposta: "Oi Ana!" 😀'), 'Oi Ana!');
  assert.strictEqual(ai.sanitize('isso e uma merda'), '');
});

test('tts: normaliza texto para pt-BR', () => {
  assert.strictEqual(tts.prepareText('oi voce... tudo bem?'), 'oi você, tudo bem?');
});

test('voz clonada: corta o resto de som depois de silencio e encurta pausas longas', () => {
  const f = path.join(os.tmpdir(), `tidy_${Date.now()}.wav`);
  // fala 1.0 s, pausa 1.5 s, fala 1.0 s, pausa 1.0 s, "resto" 0.2 s
  writeWav(f, [[1.0, 12000], [1.5, 0], [1.0, 12000], [1.0, 0], [0.2, 9000]]);
  const { tidyWav } = require('../src/lipsync');
  const r = tidyWav(f);
  const after = analyzeWav(f);
  fs.rmSync(f);
  assert.ok(r.before > 4.6);
  // 1.0 + 0.45 + 1.0 + 0.15 de folga, mais ~0.15 s por fala da suavizacao do envelope
  assert.ok(r.after > 2.5 && r.after < 3.0, `duracao final ${r.after}`);
  assert.strictEqual(after.segments.filter((s) => s.kind === 'speech').length, 2);
});

test('fala em chunks: so segura o necessario para a pausa entre frases nao passar do limite', () => {
  const { canStartSmoothly, rates } = require('../src/speech');
  const lip = (d) => ({ lip: { duration: d } });
  const item = (chars) => ({ text: 'x'.repeat(chars) });
  const saved = { ...rates };
  rates.perChar = 0.08; // 100 caracteres = 8 s de fala
  rates.synth = 2.2; // gerar 8 s de fala leva 17,6 s
  // 4 s de audio pronto e um chunk de 100 caracteres por gerar: chegaria 13,6 s depois do audio acabar
  assert.strictEqual(canStartSmoothly([lip(4)], [item(100)], 0), false);
  assert.strictEqual(canStartSmoothly([lip(4)], [item(100)], 2.5), false);
  assert.strictEqual(canStartSmoothly([lip(4)], [item(100)], 999), true); // modo fast
  // com 15 s de audio garantido a pausa seria de 2,6 s: passa com 3 s, nao com 2,5 s
  assert.strictEqual(canStartSmoothly([lip(15)], [item(100)], 3), true);
  assert.strictEqual(canStartSmoothly([lip(15)], [item(100)], 2.5), false);
  // a pausa de um chunk atrasa o relogio dos seguintes (nao soma so as folgas)
  assert.strictEqual(canStartSmoothly([lip(3)], [item(30), item(30)], 2.5), false);
  // nada mais por gerar: comeca
  assert.strictEqual(canStartSmoothly([lip(1)], [], 0), true);
  // voz rapida (GPU / voz do Windows): comeca na hora, sem pausa nenhuma
  rates.synth = 0.2;
  assert.strictEqual(canStartSmoothly([lip(2)], [item(100), item(100)], 0), true);
  Object.assign(rates, saved);
});

test('pontuacao: entrar na live vale 5 pontos, uma vez so, e quem tem 0 nao entra no TOP', () => {
  const scoring = require('../src/scoring');
  scoring.reset();
  const ana = { userId: 'ana1', uniqueId: 'ana', nickname: 'Ana', avatarUrl: '' };
  assert.deepStrictEqual(scoring.top(), []); // ninguem, ninguem aparece
  assert.ok(scoring.recordJoin(ana));
  assert.strictEqual(scoring.top().length, 1);
  assert.strictEqual(scoring.top()[0].points, 5);
  assert.strictEqual(scoring.recordJoin(ana), null); // voltar a entrar nao soma de novo
  assert.strictEqual(scoring.top()[0].points, 5);
  scoring.recordLike(ana, 1);
  assert.strictEqual(scoring.top()[0].points, 25); // 5 + 20 da curtida
  scoring.reset();
});

// formato REAL que o TikTok manda (capturado de uma live): user.id, user.displayId,
// avatarThumb.urlList, e o texto do comentario em "content"
const { normChat, normGift, normLike, normUser } = require('../src/tiktok');
const rawUser = { id: '1000000000000000001', nickname: 'viewer_teste', displayId: 'viewer_123', avatarThumb: { urlList: ['https://x/a.webp', 'https://y/a.webp'] } };

test('tiktok: comentario cru usa "content" e identifica o usuario por user.id', () => {
  const c = normChat({ common: { msgId: '1' }, user: rawUser, content: '  oi sonic   tudo bem?  ' });
  assert.strictEqual(c.comment, 'oi sonic tudo bem?');
  assert.strictEqual(c.user.userId, '1000000000000000001');
  assert.strictEqual(c.user.uniqueId, 'viewer_123');
  assert.strictEqual(c.user.nickname, 'viewer_teste');
  assert.strictEqual(c.user.avatarUrl, 'https://x/a.webp');
  // formato antigo (comment) continua funcionando
  assert.strictEqual(normChat({ user: { nickname: 'Ana' }, comment: 'oi' }).comment, 'oi');
});

test('tiktok: entrada na live nao usa o userId "0" do topo da mensagem', () => {
  const u = normUser({ userId: '0', user: rawUser });
  assert.strictEqual(u.userId, '1000000000000000001');
  assert.strictEqual(normUser({ userId: '0', user: { nickname: 'Sem Id' } }).userId, ''); // "0" nao e id
});

test('tiktok: presente cru (gift.name / gift.diamondCount / gift.type / repeatEnd numerico)', () => {
  const g = normGift({ common: { msgId: '55' }, user: rawUser, giftId: '5655', repeatCount: 3, repeatEnd: 1, gift: { name: 'Tiny Diny', diamondCount: 5, type: 1 } });
  assert.strictEqual(g.giftName, 'Tiny Diny');
  assert.strictEqual(g.totalCoins, 15);
  assert.strictEqual(g.streakable, true);
  assert.strictEqual(g.repeatEnd, true);
  assert.strictEqual(g.msgId, '55');
  assert.strictEqual(normGift({ user: rawUser, repeatCount: 2, repeatEnd: 0, gift: { name: 'Rose', diamondCount: 1, type: 1 } }).repeatEnd, false);
});

test('tiktok: curtida crua usa "count"', () => {
  assert.strictEqual(normLike({ user: rawUser, count: 7, total: '120' }).count, 7);
  assert.strictEqual(normLike({ user: rawUser, likeCount: 3 }).count, 3);
});

test('ia: palavrao leve ("foda") e bloqueado e risada solta no fim e descartada', async () => {
  assert.strictEqual(ai.isBlocked('o raposinho mais foda que existe'), true);
  assert.strictEqual(ai.isBlocked('você é fodido'), true);
  assert.strictEqual(ai.isBlocked('um desafio fantástico, adoro a fofoca de vocês'), false); // "fofoca" nao e "foda"
  const { splitChunks } = ai;
  assert.ok(splitChunks('Opa Maria, eu sou mais de correr que de molhar o pé, haha!').length >= 1);
});

test('ia: stream cortado em frases descarta a risada solta do fim mas mantem "haha" no comeco', async () => {
  const feed = async function* (text) { for (const p of text.match(/.{1,6}/g)) yield p; };
  const out = [];
  for await (const c of ai.chunksFrom(feed('Opa Maria, eu sou mais de correr que de molhar o pé, haha!'))) out.push(c);
  assert.ok(!out.some((c) => /^haha!?$/i.test(c)), JSON.stringify(out));
  assert.ok(out.join(' ').includes('molhar o pé'));
  const out2 = [];
  for await (const c of ai.chunksFrom(feed('Haha! Chili dogs, sem dúvida! Bora comer um monte!'))) out2.push(c);
  assert.ok(out2[0].startsWith('Haha'), JSON.stringify(out2)); // a risada do comeco faz parte da fala
});

test('configuracoes: valida, nao devolve chaves e so grava o que mudou', () => {
  const settings = require('../src/settings');
  const file = path.join(os.tmpdir(), `settings_${Date.now()}.json`);
  const c = { ROOT: __dirname, SETTINGS_FILE: file, AI_PROVIDER: 'ollama', AI_TEMPERATURE: 0.7, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://api.openai.com/v1' };
  assert.deepStrictEqual(settings.update(c, { AI_TEMPERATURE: 5 }).errors.length, 1);
  assert.deepStrictEqual(settings.update(c, { OPENAI_BASE_URL: 'ftp://x' }).errors.length, 1);
  assert.deepStrictEqual(settings.update(c, { AI_PROVIDER: 'foo' }).errors.length, 1);
  const r = settings.update(c, { AI_PROVIDER: 'OpenAI', OPENAI_API_KEY: 'sk-segredo', AI_TEMPERATURE: '0.7' });
  assert.deepStrictEqual(r.changed.sort(), ['AI_PROVIDER', 'OPENAI_API_KEY']);
  assert.strictEqual(c.AI_PROVIDER, 'openai');
  assert.ok(!JSON.stringify(settings.publicView(c)).includes('sk-segredo'));
  assert.strictEqual(settings.publicView(c).secretsSet.OPENAI_API_KEY, true);
  settings.update(c, { OPENAI_API_KEY: '' }); // vazio = manter
  assert.strictEqual(c.OPENAI_API_KEY, 'sk-segredo');
  settings.update(c, {}, ['OPENAI_API_KEY']); // remover
  assert.strictEqual(c.OPENAI_API_KEY, '');
  fs.rmSync(file, { force: true });
});
