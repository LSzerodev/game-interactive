// Configuracoes editaveis pelo painel. O schema abaixo descreve cada campo (o painel monta
// a tela a partir dele) e valida o que chega. O valor fica em src/config.js (o mesmo objeto
// para todos os modulos) e e salvo em private/settings.json, que vale mais do que o .env.
const fs = require('fs');
const path = require('path');

const AI_PROVIDERS = ['ollama', 'openai', 'gemini'];
const TTS_PROVIDERS = ['sapi', 'openai', 'gemini', 'elevenlabs', 'xtts', 'chatterbox'];

// group: aba do painel | type: text | password | number | select | bool
// when: so aparece quando outro campo tem um dos valores (ex.: { AI_PROVIDER: ['openai'] })
const SCHEMA = [
  // ---- TikTok
  { key: 'TIKTOK_USERNAME', group: 'tiktok', type: 'text', label: 'Usuário do TikTok', help: 'Sem o @. A live desse usuário é monitorada.' },
  { key: 'TIKTOK_PROXY', group: 'tiktok', type: 'text', label: 'Proxy (opcional)', help: 'Ex.: socks5h://127.0.0.1:9050' },
  { key: 'CHARACTER_NAME', group: 'tiktok', type: 'text', label: 'Nome do personagem', help: 'Deixe vazio para a IA não citar nome.' },

  // ---- IA
  { key: 'AI_PROVIDER', group: 'ia', type: 'select', label: 'Quem escreve as respostas', options: [['ollama', 'Ollama (local, grátis)'], ['openai', 'OpenAI / compatível'], ['gemini', 'Google Gemini']] },
  { key: 'AI_TEMPERATURE', group: 'ia', type: 'number', label: 'Criatividade (0 a 2)', min: 0, max: 2, step: 0.1 },
  { key: 'REPLY_LENGTH', group: 'ia', type: 'select', label: 'Tamanho da resposta', options: [['curta', 'Curta (~1 frase)'], ['normal', 'Normal (até 2 frases)']] },
  { key: 'OLLAMA_URL', group: 'ia', type: 'text', label: 'Endereço do Ollama', when: { AI_PROVIDER: ['ollama'] } },
  { key: 'OLLAMA_MODEL', group: 'ia', type: 'text', label: 'Modelo do Ollama', help: 'Ex.: gemma4:e4b, llama3.2, qwen2.5', when: { AI_PROVIDER: ['ollama'] } },
  { key: 'OLLAMA_NUM_CTX', group: 'ia', type: 'number', label: 'Contexto do Ollama', min: 1024, step: 1024, help: 'Mudar recarrega o modelo.', when: { AI_PROVIDER: ['ollama'] } },
  { key: 'OPENAI_API_KEY', group: 'ia', type: 'password', secret: true, label: 'Chave da OpenAI', help: 'Também usada na voz da OpenAI. Gere em platform.openai.com/api-keys.', when: { AI_PROVIDER: ['openai'] } },
  { key: 'OPENAI_BASE_URL', group: 'ia', type: 'text', label: 'Endereço da API', help: 'Troque para usar Groq, OpenRouter, DeepSeek, LM Studio... (qualquer API no formato da OpenAI).', when: { AI_PROVIDER: ['openai'] } },
  { key: 'OPENAI_MODEL', group: 'ia', type: 'text', label: 'Modelo de texto', help: 'Ex.: gpt-4o-mini', when: { AI_PROVIDER: ['openai'] } },
  { key: 'GEMINI_API_KEY', group: 'ia', type: 'password', secret: true, label: 'Chave do Gemini', help: 'Gere de graça em aistudio.google.com/apikey. Também usada na voz do Gemini.', when: { AI_PROVIDER: ['gemini'] } },
  { key: 'GEMINI_MODEL', group: 'ia', type: 'text', label: 'Modelo de texto', help: 'Ex.: gemini-2.5-flash', when: { AI_PROVIDER: ['gemini'] } },

  // ---- Voz
  { key: 'TTS_PROVIDER', group: 'voz', type: 'select', label: 'Quem fala', options: [['sapi', 'Voz do Windows (offline, sem instalar nada)'], ['openai', 'OpenAI (API)'], ['gemini', 'Google Gemini (API)'], ['elevenlabs', 'ElevenLabs (API)'], ['xtts', 'XTTS: voz clonada local (uso não comercial)'], ['chatterbox', 'Chatterbox: voz clonada local (MIT)']] },
  { key: 'SAPI_VOICE', group: 'voz', type: 'text', label: 'Voz do Windows', help: 'Parte do nome da voz instalada (ex.: Maria). Sem achar, usa qualquer pt-BR.', when: { TTS_PROVIDER: ['sapi'] } },
  { key: 'OPENAI_API_KEY', group: 'voz', type: 'password', secret: true, label: 'Chave da OpenAI', help: 'A mesma da aba IA.', when: { TTS_PROVIDER: ['openai'] } },
  { key: 'OPENAI_BASE_URL', group: 'voz', type: 'text', label: 'Endereço da API', when: { TTS_PROVIDER: ['openai'] } },
  { key: 'OPENAI_TTS_MODEL', group: 'voz', type: 'text', label: 'Modelo de voz', help: 'gpt-4o-mini-tts, tts-1 ou tts-1-hd', when: { TTS_PROVIDER: ['openai'] } },
  { key: 'OPENAI_TTS_VOICE', group: 'voz', type: 'text', label: 'Voz', help: 'nova, alloy, echo, fable, onyx, shimmer, coral...', when: { TTS_PROVIDER: ['openai'] } },
  { key: 'GEMINI_API_KEY', group: 'voz', type: 'password', secret: true, label: 'Chave do Gemini', help: 'A mesma da aba IA.', when: { TTS_PROVIDER: ['gemini'] } },
  { key: 'GEMINI_TTS_MODEL', group: 'voz', type: 'text', label: 'Modelo de voz', help: 'Ex.: gemini-2.5-flash-preview-tts', when: { TTS_PROVIDER: ['gemini'] } },
  { key: 'GEMINI_TTS_VOICE', group: 'voz', type: 'text', label: 'Voz', help: 'Kore, Puck, Charon, Zephyr, Aoede, Fenrir, Leda, Orus...', when: { TTS_PROVIDER: ['gemini'] } },
  { key: 'ELEVENLABS_API_KEY', group: 'voz', type: 'password', secret: true, label: 'Chave da ElevenLabs', help: 'Gere em elevenlabs.io (Settings > API Keys).', when: { TTS_PROVIDER: ['elevenlabs'] } },
  { key: 'ELEVENLABS_VOICE_ID', group: 'voz', type: 'text', label: 'ID da voz', help: 'Copie da sua biblioteca de vozes (pode ser uma voz clonada sua).', when: { TTS_PROVIDER: ['elevenlabs'] } },
  { key: 'ELEVENLABS_MODEL', group: 'voz', type: 'text', label: 'Modelo', help: 'eleven_multilingual_v2 ou eleven_flash_v2_5 (mais rápido)', when: { TTS_PROVIDER: ['elevenlabs'] } },
  { key: 'VOICE_REFERENCE_WAV', group: 'voz', type: 'text', label: 'Áudio de referência da voz', help: 'WAV de 6 a 30 s com a voz a clonar.', when: { TTS_PROVIDER: ['xtts', 'chatterbox'] } },
  { key: 'VOICE_AUTOSTART', group: 'voz', type: 'bool', label: 'Iniciar o servidor de voz junto', when: { TTS_PROVIDER: ['xtts', 'chatterbox'] } },
  { key: 'XTTS_URL', group: 'voz', type: 'text', label: 'Endereço do XTTS', when: { TTS_PROVIDER: ['xtts'] } },
  { key: 'CHATTERBOX_URL', group: 'voz', type: 'text', label: 'Endereço do Chatterbox', when: { TTS_PROVIDER: ['chatterbox'] } },
  { key: 'COQUI_TOS_AGREED', group: 'voz', type: 'bool', label: 'Aceito a Coqui Public Model License (uso não comercial)', when: { TTS_PROVIDER: ['xtts'] } },
  { key: 'SPEECH_MAX_GAP_SECONDS', group: 'voz', type: 'number', label: 'Maior pausa entre frases (s)', min: 0, max: 999, help: '0 = sem pausas (começa mais tarde) | 6 = padrão | 999 = toca cada frase assim que sai. Com voz por API pode deixar 999.' },
];

const SCHEMA_KEYS = new Map(SCHEMA.map((f) => [f.key, f]));
const LOWER = new Set(['AI_PROVIDER', 'TTS_PROVIDER', 'REPLY_LENGTH']);

// Converte e valida um valor vindo do painel. Devolve { ok, value } ou { ok:false, error }.
function coerce(field, raw) {
  if (field.type === 'bool') return { ok: true, value: raw === true || raw === 'true' || raw === '1' || raw === 1 };
  if (field.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `${field.label}: número inválido` };
    if (field.min !== undefined && n < field.min) return { ok: false, error: `${field.label}: mínimo ${field.min}` };
    if (field.max !== undefined && n > field.max) return { ok: false, error: `${field.label}: máximo ${field.max}` };
    return { ok: true, value: n };
  }
  let v = String(raw ?? '').trim();
  if (LOWER.has(field.key)) v = v.toLowerCase();
  if (field.type === 'select' && !field.options.some(([o]) => o === v)) return { ok: false, error: `${field.label}: opção inválida` };
  if (/_URL$/.test(field.key) && v && !/^https?:\/\//i.test(v)) return { ok: false, error: `${field.label}: precisa começar com http:// ou https://` };
  return { ok: true, value: v };
}

function applyValue(cfg, key, value) {
  cfg[key] = key === 'VOICE_REFERENCE_WAV' ? path.resolve(cfg.ROOT, value || 'assets/voice/default.wav') : value;
}

// Aplica um objeto { CHAVE: valor } no cfg, ignorando o que nao esta no schema. Usado ao carregar o arquivo.
function applySettings(cfg, saved) {
  for (const [key, raw] of Object.entries(saved || {})) {
    const field = SCHEMA_KEYS.get(key);
    if (!field) continue;
    const r = coerce(field, raw);
    if (r.ok) applyValue(cfg, key, r.value);
  }
}

// Atualiza pelo painel. `clear` lista chaves secretas a apagar. Devolve { changed, errors }.
function update(cfg, patch, clear = []) {
  const errors = [];
  const changed = [];
  const pending = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    const field = SCHEMA_KEYS.get(key);
    if (!field) continue;
    if (field.secret && String(raw ?? '').trim() === '') continue; // vazio = manter a chave atual
    const r = coerce(field, raw);
    if (!r.ok) errors.push(r.error);
    else pending[key] = r.value;
  }
  for (const key of clear) if (SCHEMA_KEYS.get(key)?.secret) pending[key] = '';
  if (errors.length) return { changed, errors };

  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(cfg.SETTINGS_FILE, 'utf8'));
  } catch {
    /* primeiro salvamento */
  }
  for (const [key, value] of Object.entries(pending)) {
    const before = cfg[key];
    applyValue(cfg, key, value);
    if (cfg[key] !== before) {
      changed.push(key);
      saved[key] = value; // so grava o que mudou: o resto continua valendo pelo .env / padrao
    }
  }
  fs.mkdirSync(path.dirname(cfg.SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(cfg.SETTINGS_FILE, JSON.stringify(saved, null, 2));
  return { changed, errors };
}

// O que o painel recebe: nunca devolve as chaves, so se existem.
function publicView(cfg) {
  const values = {};
  const secretsSet = {};
  for (const f of SCHEMA) {
    if (f.secret) secretsSet[f.key] = Boolean(cfg[f.key]);
    else values[f.key] = cfg[f.key];
  }
  return { schema: SCHEMA, values, secretsSet };
}

module.exports = { SCHEMA, AI_PROVIDERS, TTS_PROVIDERS, applySettings, update, publicView };
