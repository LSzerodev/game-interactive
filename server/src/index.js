const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const bridge = require('./bridge');
const speech = require('./speech');
const scoring = require('./scoring');
const log = require('./log');
const director = require('./director');
const { TikTokMonitor } = require('./tiktok');
const ai = require('./ai');
const tts = require('./tts');
const settings = require('./settings');
const diagnostics = require('./diagnostics');
const voiceService = require('./voice_service');

const monitor = new TikTokMonitor();
director.wire(monitor);

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(s || '{}'));
      } catch {
        resolve({});
      }
    });
  });

// Quais configuracoes pedem que a IA / a voz sejam recarregadas quando mudam
const AI_KEYS = new Set(['AI_PROVIDER', 'OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_NUM_CTX', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL']);
const VOICE_KEYS = new Set(['TTS_PROVIDER', 'VOICE_REFERENCE_WAV', 'VOICE_AUTOSTART', 'XTTS_URL', 'CHATTERBOX_URL', 'COQUI_TOS_AGREED']);

const PERSONA_PRIVATE = path.join(cfg.PRIVATE_DIR, 'persona.md');
const PERSONA_DEFAULT = path.join(cfg.ROOT, 'config', 'persona.md');
const GIFTS_PRIVATE = path.join(cfg.PRIVATE_DIR, 'gift_actions.json');
const GIFTS_DEFAULT = path.join(cfg.ROOT, 'config', 'gift_actions.json');
const readFirst = (files) => {
  for (const f of files) {
    try {
      return { text: fs.readFileSync(f, 'utf8'), custom: f.startsWith(cfg.PRIVATE_DIR) };
    } catch {
      /* tenta o proximo */
    }
  }
  return { text: '', custom: false };
};

// O painel e local, mas qualquer site aberto no navegador consegue chamar 127.0.0.1.
// Aceita so pedidos feitos pelo proprio painel (Host e Origin = este servidor), o que tambem barra DNS rebinding.
function trusted(req) {
  const ok = new Set([`127.0.0.1:${cfg.PORT}`, `localhost:${cfg.PORT}`]);
  if (!ok.has(String(req.headers.host || ''))) return false;
  const origin = req.headers.origin;
  return !origin || ok.has(origin.replace(/^https?:\/\//, ''));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!trusted(req)) return json(res, 403, { error: 'origem não permitida' });
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'panel.html')));
  }
  // imagem usada so pelo simulador (avatar de teste)
  if (req.method === 'GET' && url.pathname === '/test/avatar-teste.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'test', 'avatar-teste.png')));
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return json(res, 200, {
      tiktok: monitor.state,
      godot: bridge.connected,
      speech: speech.status(),
      ia: { provider: ai.providerLabel(), model: ai.modelName(), ready: ai.isWarm() },
      voice: { provider: cfg.TTS_PROVIDER, ready: voiceService.isReady() },
      top: scoring.top(),
      events: log.stats(),
      uptime: Math.round(process.uptime()),
    });
  }
  // log da live (o painel consulta a cada segundo: ?since=<ultimo id recebido>)
  if (req.method === 'GET' && url.pathname === '/api/logs') {
    return json(res, 200, { logs: log.since(Number(url.searchParams.get('since')) || 0), stats: log.stats() });
  }
  if (req.method === 'POST' && url.pathname === '/api/logs/clear') {
    log.clear();
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/connect') {
    const { username } = await readBody(req);
    const name = String(username || cfg.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
    if (!name) {
      log.warn('tiktok', 'informe o usuário do TikTok para conectar');
      return json(res, 400, { ok: false, error: 'usuario vazio' });
    }
    monitor.stop();
    monitor.start(name).catch((e) => log.error('tiktok', e.message));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/reset-score') {
    scoring.reset();
    director.pushTop(true);
    log.ok('placar', 'placar zerado');
    return json(res, 200, { ok: true });
  }
  // --- configuracoes (aba Configuracoes do painel) ---
  if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, 200, settings.publicView(cfg));
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const b = await readBody(req);
    const { changed, errors } = settings.update(cfg, b.values, Array.isArray(b.clear) ? b.clear : []);
    if (errors.length) return json(res, 400, { ok: false, errors });
    if (changed.length) log.ok('config', `configurações salvas: ${changed.join(', ')}`);
    if (changed.some((k) => AI_KEYS.has(k))) ai.warmup();
    if (changed.some((k) => VOICE_KEYS.has(k))) {
      speech.resetRates();
      voiceService.restart();
    }
    return json(res, 200, { ok: true, changed, ...settings.publicView(cfg) });
  }
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') return json(res, 200, await diagnostics.all(url.searchParams.get('ia'), url.searchParams.get('voz')));
  if (req.method === 'POST' && url.pathname === '/api/test/ia') {
    try {
      return json(res, 200, { ok: true, ...(await ai.testConnection()) });
    } catch (e) {
      log.warn('ia', `teste falhou: ${e.message}`);
      return json(res, 200, { ok: false, error: e.message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/test/voice') {
    try {
      const r = await tts.test();
      const wav = fs.readFileSync(r.file);
      fs.rm(r.file, () => {});
      log.ok('voz', `teste de voz (${r.provider}) em ${r.seconds} s`);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'X-Seconds': String(r.seconds) });
      return res.end(wav);
    } catch (e) {
      log.warn('voz', `teste falhou: ${e.message}`);
      return json(res, 200, { ok: false, error: e.message });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/persona') {
    const cur = readFirst([PERSONA_PRIVATE, PERSONA_DEFAULT]);
    return json(res, 200, { text: cur.text, custom: cur.custom });
  }
  if (req.method === 'POST' && url.pathname === '/api/persona') {
    const b = await readBody(req);
    if (b.reset) fs.rmSync(PERSONA_PRIVATE, { force: true });
    else if (typeof b.text === 'string' && b.text.trim()) {
      fs.mkdirSync(cfg.PRIVATE_DIR, { recursive: true });
      fs.writeFileSync(PERSONA_PRIVATE, b.text);
    } else return json(res, 400, { ok: false, error: 'o prompt não pode ficar vazio' });
    log.ok('config', b.reset ? 'personagem restaurado para o padrão' : 'prompt do personagem salvo');
    if (cfg.AI_PROVIDER === 'ollama') ai.warmup(); // reprocessa o prompt novo antes do proximo comentario
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/gifts') {
    const cur = readFirst([GIFTS_PRIVATE, GIFTS_DEFAULT]);
    return json(res, 200, { text: cur.text, custom: cur.custom });
  }
  if (req.method === 'POST' && url.pathname === '/api/gifts') {
    const b = await readBody(req);
    if (b.reset) fs.rmSync(GIFTS_PRIVATE, { force: true });
    else {
      try {
        const parsed = JSON.parse(String(b.text || ''));
        if (!parsed || typeof parsed.gifts !== 'object') throw new Error('falta o campo "gifts"');
      } catch (e) {
        return json(res, 400, { ok: false, error: `JSON inválido: ${e.message}` });
      }
      fs.mkdirSync(cfg.PRIVATE_DIR, { recursive: true });
      fs.writeFileSync(GIFTS_PRIVATE, b.text);
    }
    log.ok('config', b.reset ? 'presentes restaurados para o padrão' : 'ações dos presentes salvas');
    return json(res, 200, { ok: true });
  }
  // --- simulacao (testar sem estar ao vivo) ---
  if (req.method === 'POST' && url.pathname === '/api/simulate/chat') {
    const b = await readBody(req);
    log.info('chat', `(simulado) ${b.user || 'Teste'}: ${String(b.comment || 'oi, tudo bem?')}`);
    director.onChat({
      user: { userId: b.user || 'teste', uniqueId: b.user || 'teste', nickname: b.user || 'Teste', avatarUrl: String(b.avatar || '') },
      comment: String(b.comment || 'oi, tudo bem?'),
    });
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/simulate/gift') {
    const b = await readBody(req);
    const coins = Number(b.coins ?? 1);
    const count = Number(b.count ?? 1);
    director.onGift({
      user: { userId: b.user || 'teste', uniqueId: b.user || 'teste', nickname: b.user || 'Teste', avatarUrl: String(b.avatar || '') },
      giftName: String(b.gift || 'Rose'),
      count,
      coinValue: coins,
      totalCoins: coins * count,
    });
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/simulate/join') {
    const b = await readBody(req);
    const name = String(b.user || 'Visitante');
    director.onJoin({ user: { userId: name, uniqueId: name, nickname: name, avatarUrl: String(b.avatar || '') } });
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
});

bridge.attach(server);
server.listen(cfg.PORT, '127.0.0.1', () => {
  log.ok('tiktok', `servidor no ar: painel em http://127.0.0.1:${cfg.PORT}`);
  log.info('tiktok', 'Live 3D, código aberto por Luis Felipe. Mais jogos na comunidade: https://t.me/+dodaVsUWVoQ0Yjhh');
  ai.warmup();
  voiceService.start();
  if (cfg.TIKTOK_USERNAME) {
    monitor.start(cfg.TIKTOK_USERNAME).catch((e) => log.error('tiktok', e.message));
  } else {
    log.warn('tiktok', 'nenhuma live conectada: defina TIKTOK_USERNAME no .env ou conecte pelo painel');
  }
});
