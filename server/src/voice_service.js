// Inicia o servidor de voz clonada (server/voice/voice_server.py) quando
// TTS_PROVIDER e xtts ou chatterbox, e o encerra junto com o painel.
// Cada motor tem o seu ambiente Python (venv-xtts / venv-chatterbox) porque
// os dois fixam versoes diferentes de torch/transformers.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const log = require('./log');

const ENGINES = {
  xtts: { venv: 'venv-xtts', url: () => cfg.XTTS_URL },
  chatterbox: { venv: 'venv-chatterbox', url: () => cfg.CHATTERBOX_URL },
};

let child = null;
let ready = false;

async function healthy(url) {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function start() {
  const engine = ENGINES[cfg.TTS_PROVIDER];
  if (!engine || !cfg.VOICE_AUTOSTART) return;
  const url = engine.url();
  if (await healthy(url)) {
    ready = true;
    log.ok('voz', `${cfg.TTS_PROVIDER} ja estava rodando em ${url}`);
    return;
  }
  if (cfg.TTS_PROVIDER === 'xtts' && !cfg.COQUI_TOS_AGREED) {
    log.warn('voz', 'XTTS v2 exige aceitar a Coqui Public Model License: defina COQUI_TOS_AGREED=1 no .env');
    return;
  }
  const python = path.join(cfg.VOICE_DIR, engine.venv, 'Scripts', 'python.exe');
  if (!fs.existsSync(python)) {
    log.warn('voz', `ambiente ${engine.venv} nao encontrado em server/voice; veja o README (instalacao da voz)`);
    return;
  }
  const port = new URL(url).port;
  const logFd = fs.openSync(path.join(cfg.VOICE_DIR, `${cfg.TTS_PROVIDER}.log`), 'a');
  child = spawn(
    python,
    ['-u', 'voice_server.py', '--engine', cfg.TTS_PROVIDER, '--port', port, '--warmup-wav', cfg.VOICE_REFERENCE_WAV],
    {
      cwd: cfg.VOICE_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', COQUI_TOS_AGREED: cfg.COQUI_TOS_AGREED ? '1' : '0' },
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    },
  );
  const me = child;
  me.on('exit', (code) => {
    if (child !== me) return; // parado de proposito (troca de voz no painel)
    ready = false;
    child = null;
    log.warn('voz', `servidor ${cfg.TTS_PROVIDER} parou (codigo ${code}); veja server/voice/${cfg.TTS_PROVIDER}.log`);
  });
  log.ok('voz', `iniciando ${cfg.TTS_PROVIDER} (o modelo leva ~1 min para carregar)...`);
  for (let i = 0; i < 600 && child; i++) {
    if (await healthy(url)) {
      ready = true;
      log.ok('voz', `${cfg.TTS_PROVIDER} pronto em ${url}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function stop() {
  if (child) child.kill();
}

// O painel trocou a voz: derruba o servidor do motor anterior e sobe o do novo (se for local).
function restart() {
  const old = child;
  child = null;
  ready = false;
  if (old) old.kill();
  return start();
}

process.on('exit', stop);
process.on('SIGINT', () => process.exit(0));

module.exports = { start, stop, restart, isReady: () => ready, status: () => ({ ready, running: !!child }) };
