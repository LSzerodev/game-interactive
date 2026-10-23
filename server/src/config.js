const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// .env minimalista (sem dependencia extra)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  ROOT,
  RUNS_DIR: path.join(ROOT, 'runs'),
  AUDIO_DIR: path.join(ROOT, 'runs', 'audio'),
  PRIVATE_DIR: path.join(ROOT, 'private'),
  PORT: Number(env('PORT', '9393')),
  TIKTOK_USERNAME: env('TIKTOK_USERNAME'),
  TIKTOK_PROXY: env('TIKTOK_PROXY'),
  CHARACTER_NAME: env('CHARACTER_NAME'),
  OLLAMA_URL: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
  OLLAMA_MODEL: env('OLLAMA_MODEL', 'gemma4:e4b'),
  // Contexto fixo: o prompt do personagem tem ~2900 tokens (o padrao do Ollama, 4096,
  // truncaria o prompt com historico) e MUDAR o valor entre requisicoes recarrega o modelo.
  // maior pausa (s) aceita entre as frases de uma resposta: 0 = nenhuma (comeca a falar
  // mais tarde), 999 = toca cada frase assim que fica pronta (comeca antes, com pausas)
  SPEECH_MAX_GAP_SECONDS: Number(env('SPEECH_MAX_GAP_SECONDS', '6')),
  // curta (~1 frase, resposta mais rapida) | normal (ate 2 frases)
  REPLY_LENGTH: env('REPLY_LENGTH', 'curta').toLowerCase(),
  OLLAMA_NUM_CTX: Number(env('OLLAMA_NUM_CTX', '8192')),
  // --- IA (quem escreve as respostas): ollama (local) | openai (e compativeis) | gemini ---
  AI_PROVIDER: env('AI_PROVIDER', 'ollama').toLowerCase(),
  AI_TEMPERATURE: Number(env('AI_TEMPERATURE', '0.7')),
  OPENAI_API_KEY: env('OPENAI_API_KEY'),
  // troque para usar qualquer API compativel com a da OpenAI (Groq, OpenRouter, DeepSeek, LM Studio...)
  OPENAI_BASE_URL: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
  OPENAI_MODEL: env('OPENAI_MODEL', 'gpt-4o-mini'),
  GEMINI_API_KEY: env('GEMINI_API_KEY'),
  GEMINI_MODEL: env('GEMINI_MODEL', 'gemini-2.5-flash'),
  // --- Voz por API ---
  GEMINI_TTS_MODEL: env('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
  GEMINI_TTS_VOICE: env('GEMINI_TTS_VOICE', 'Kore'),
  ELEVENLABS_API_KEY: env('ELEVENLABS_API_KEY'),
  ELEVENLABS_VOICE_ID: env('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM'),
  ELEVENLABS_MODEL: env('ELEVENLABS_MODEL', 'eleven_multilingual_v2'),
  TTS_PROVIDER: env('TTS_PROVIDER', 'sapi').toLowerCase(),
  SAPI_VOICE: env('SAPI_VOICE', 'Maria'),
  XTTS_URL: env('XTTS_URL', 'http://127.0.0.1:8020'),
  CHATTERBOX_URL: env('CHATTERBOX_URL', 'http://127.0.0.1:8021'),
  VOICE_REFERENCE_WAV: path.resolve(ROOT, env('VOICE_REFERENCE_WAV', env('XTTS_SPEAKER_WAV', 'assets/voice/default.wav'))),
  VOICE_DIR: path.join(ROOT, 'voice'),
  // o servidor de voz e iniciado junto (0 = voce sobe ele manualmente)
  VOICE_AUTOSTART: env('VOICE_AUTOSTART', '1') !== '0',
  // aceite da Coqui Public Model License (necessario para baixar/usar o XTTS v2)
  COQUI_TOS_AGREED: env('COQUI_TOS_AGREED', '0') === '1',
  OPENAI_TTS_MODEL: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: env('OPENAI_TTS_VOICE', 'nova'),
  SETTINGS_FILE: path.join(ROOT, 'private', 'settings.json'),
};

// Configuracoes salvas pelo painel (private/settings.json) valem mais do que o .env.
// O objeto e o mesmo para todos os modulos, entao o que muda aqui vale na hora.
try {
  const saved = JSON.parse(fs.readFileSync(module.exports.SETTINGS_FILE, 'utf8'));
  require('./settings').applySettings(module.exports, saved);
} catch {
  /* sem arquivo (ou invalido): vale o .env */
}
