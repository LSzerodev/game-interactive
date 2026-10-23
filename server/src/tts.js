// Texto -> WAV. Provedores (TTS_PROVIDER no .env):
//   sapi       : vozes do Windows (System.Speech), offline, sem instalar nada
//   xtts       : Coqui XTTS v2 clonando VOICE_REFERENCE_WAV (licenca NAO comercial)
//   chatterbox : Chatterbox multilingue clonando VOICE_REFERENCE_WAV (MIT)
//   openai     : /v1/audio/speech (OPENAI_API_KEY; OPENAI_BASE_URL para APIs compativeis)
//   gemini     : Gemini TTS (GEMINI_API_KEY)
//   elevenlabs : ElevenLabs (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID)
// Tudo isso e escolhido no painel (aba Voz). Se uma API falhar, aquela fala sai com a voz do Windows.
// xtts/chatterbox rodam em server/voice/voice_server.py (iniciado por voice_service.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const cfg = require('./config');
const log = require('./log');
const { tidyWav } = require('./lipsync');

const ACCENTS = {
  nao: 'não', voce: 'você', voces: 'vocês', tambem: 'também', ate: 'até', ja: 'já',
  alguem: 'alguém', ninguem: 'ninguém', alem: 'além', acao: 'ação', coracao: 'coração',
  emocao: 'emoção', historia: 'história', maca: 'maçã', macas: 'maçãs', agradeco: 'agradeço',
};

function prepareText(text, { xtts = false } = {}) {
  let t = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b[A-Za-zÀ-ÿ]+\b/g, (w) => {
    const r = ACCENTS[w.toLowerCase()];
    if (!r) return w;
    return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
  t = t.replace(/\.{2,}|…+/g, ', ').replace(/(?<!\d)\.(?!\d)/g, ',').replace(/\s+([,!?;:])/g, '$1');
  t = t.replace(/([,!?;:]){2,}/g, '$1').replace(/\s+/g, ' ').trim().replace(/^[ ,;:]+|[ ,;:]+$/g, '');
  // XTTS pronuncia "ç" estranho e "x" de "explicar" como "ks"
  if (xtts) t = t.replace(/ç/g, 'ss').replace(/Ç/g, 'SS').replace(/\bexpl/gi, (m) => 'espl');
  return t;
}

function outFile() {
  fs.mkdirSync(cfg.AUDIO_DIR, { recursive: true });
  return path.join(cfg.AUDIO_DIR, `speech_${crypto.randomBytes(6).toString('hex')}.wav`);
}

function sapi(text, out) {
  const txt = out + '.txt';
  fs.writeFileSync(txt, text, 'utf8');
  const script = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$want = '${cfg.SAPI_VOICE.replace(/'/g, "''")}';`,
    '$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo };',
    '$pick = $v | Where-Object { $_.Name -like "*$want*" } | Select-Object -First 1;',
    "if (-not $pick) { $pick = $v | Where-Object { $_.Culture.Name -eq 'pt-BR' } | Select-Object -First 1 };",
    'if ($pick) { $s.SelectVoice($pick.Name) };',
    `$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}');`,
    `$s.Speak([IO.File]::ReadAllText('${txt.replace(/'/g, "''")}', [Text.Encoding]::UTF8));`,
    '$s.Dispose();',
  ].join(' ');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60000 }, (err) => {
      fs.rm(txt, () => {});
      err ? reject(err) : resolve(out);
    });
  });
}

// Servidor de voz local (server/voice/voice_server.py): XTTS v2 ou Chatterbox,
// os dois com a mesma API e clonando a voz de VOICE_REFERENCE_WAV.
async function cloned(engine, text, out) {
  if (!fs.existsSync(cfg.VOICE_REFERENCE_WAV)) throw new Error(`Voz de referencia ausente: ${cfg.VOICE_REFERENCE_WAV}`);
  const base = engine === 'chatterbox' ? cfg.CHATTERBOX_URL : cfg.XTTS_URL;
  const res = await fetch(`${base.replace(/\/$/, '')}/tts_to_audio/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, speaker_wav: cfg.VOICE_REFERENCE_WAV, language: 'pt' }),
    signal: AbortSignal.timeout(120000), // CPU: frases longas podem levar dezenas de segundos
  });
  if (!res.ok) throw new Error(`${engine} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  tidyWav(out); // tira silencios longos e o "resto" de som no final
  return out;
}

const trimUrl = (u) => String(u || '').replace(/\/+$/, '');

async function apiError(name, res) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j.error?.message || j.detail?.message || j.detail || j.error || body;
    } catch {
      detail = body;
    }
  } catch {
    /* sem corpo */
  }
  const hint = res.status === 401 || res.status === 403 ? ' (chave inválida ou sem permissão)' : res.status === 429 ? ' (limite de uso ou sem créditos)' : '';
  return new Error(`${name} HTTP ${res.status}${hint}: ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).replace(/\s+/g, ' ').slice(0, 200)}`);
}

// PCM cru (16 bits, mono) -> arquivo WAV
function writePcmWav(out, pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(out, Buffer.concat([h, pcm]));
}

async function openai(text, out) {
  const official = /api\.openai\.com/.test(cfg.OPENAI_BASE_URL);
  if (official && !cfg.OPENAI_API_KEY) throw new Error('chave da OpenAI não configurada (aba Voz do painel)');
  const res = await fetch(`${trimUrl(cfg.OPENAI_BASE_URL)}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.OPENAI_API_KEY ? { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` } : {}) },
    body: JSON.stringify({ model: cfg.OPENAI_TTS_MODEL, voice: cfg.OPENAI_TTS_VOICE, input: text, response_format: 'wav' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw await apiError('OpenAI TTS', res);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

// Gemini devolve PCM 24 kHz em base64 dentro do JSON.
async function gemini(text, out) {
  if (!cfg.GEMINI_API_KEY) throw new Error('chave do Gemini não configurada (aba Voz do painel)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.GEMINI_TTS_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.GEMINI_TTS_VOICE } } },
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw await apiError('Gemini TTS', res);
  const part = ((await res.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('Gemini TTS não devolveu áudio');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  writePcmWav(out, Buffer.from(part.inlineData.data, 'base64'), rate);
  return out;
}

// ElevenLabs: pcm_24000 evita decodificar MP3 (vem 16 bits, mono, 24 kHz).
async function elevenlabs(text, out) {
  if (!cfg.ELEVENLABS_API_KEY) throw new Error('chave da ElevenLabs não configurada (aba Voz do painel)');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.ELEVENLABS_VOICE_ID)}?output_format=pcm_24000`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': cfg.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: cfg.ELEVENLABS_MODEL }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw await apiError('ElevenLabs', res);
  writePcmWav(out, Buffer.from(await res.arrayBuffer()), 24000);
  return out;
}

const API_VOICES = { openai, gemini, elevenlabs };

async function synthesize(text) {
  const provider = cfg.TTS_PROVIDER;
  const clean = prepareText(text, { xtts: provider === 'xtts' });
  if (!clean) throw new Error('Texto vazio');
  const out = outFile();
  if (provider === 'xtts' || provider === 'chatterbox') {
    try {
      return await cloned(provider, clean, out);
    } catch (e) {
      // a live nao fica muda: cai para a voz do Windows nesta fala
      log.warn('voz', `${provider} falhou (${e.message}); usei a voz do Windows nesta fala`);
      return sapi(prepareText(text), out);
    }
  }
  if (API_VOICES[provider]) {
    try {
      return await API_VOICES[provider](clean, out);
    } catch (e) {
      log.warn('voz', `${provider} falhou (${e.message}); usei a voz do Windows nesta fala`);
      return sapi(clean, out);
    }
  }
  return sapi(clean, out);
}

// Botao "Testar" do painel: gera uma frase curta com as configuracoes atuais.
async function test() {
  const t = Date.now();
  const clean = prepareText('Olá! Este é um teste de voz.', { xtts: cfg.TTS_PROVIDER === 'xtts' });
  const out = outFile();
  const provider = cfg.TTS_PROVIDER;
  if (provider === 'xtts' || provider === 'chatterbox') await cloned(provider, clean, out);
  else if (API_VOICES[provider]) await API_VOICES[provider](clean, out);
  else await sapi(clean, out);
  return { file: out, seconds: +((Date.now() - t) / 1000).toFixed(1), provider };
}

module.exports = { synthesize, prepareText, test };
