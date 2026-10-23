// Sincronia labial: analisa o WAV gerado pelo TTS e produz
//  - envelope: abertura da boca (0..1) a cada `hop` segundos
//  - segments: trechos "speech" / "micro_pause" / "pause" (para pausas e respiro)
// O Godot toca o audio e le o envelope na posicao de reproducao, entao a boca
// abre/fecha exatamente com a energia da voz, sem depender de fonemas.
const fs = require('fs');

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Arquivo nao e WAV');
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (start + size > buf.length) size = buf.length - start; // streams com tamanho 0xFFFFFFFF
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        rate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(start, start + size);
      break;
    }
    pos = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV sem fmt/data');
  return { ...fmt, data };
}

// Converte para amostras mono normalizadas (-1..1)
function toMono({ format, channels, bits, data }) {
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      let v;
      if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 32 && format === 3) v = data.readFloatLE(o);
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (data[o] - 128) / 128;
      else if (bits === 24) v = (data.readIntLE(o, 3)) / 8388608;
      else throw new Error(`WAV de ${bits} bits nao suportado`);
      sum += v;
    }
    out[i] = sum / channels;
  }
  return out;
}

function analyzeWav(file, { hop = 0.03, smooth = 0.5 } = {}) {
  const wav = readWav(fs.readFileSync(file));
  const samples = toMono(wav);
  const win = Math.max(1, Math.round(wav.rate * hop));
  const rms = [];
  for (let i = 0; i < samples.length; i += win) {
    let acc = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) acc += samples[j] * samples[j];
    rms.push(Math.sqrt(acc / Math.max(1, end - i)));
  }
  const peak = Math.max(1e-6, ...rms);
  const floor = Math.max(0.0035, peak * 0.12); // abaixo disso a boca fecha
  // normaliza para 0..1 com curva suave (boca nao "pisca" em ruido)
  let prev = 0;
  const envelope = rms.map((e) => {
    const n = Math.min(1, Math.max(0, (e - floor) / (peak - floor)));
    const target = Math.pow(n, 0.7);
    prev = prev * smooth + target * (1 - smooth);
    return Math.round(prev * 1000) / 1000;
  });

  // segmentos fala/pausa a partir do envelope
  const segments = [];
  let kind = null;
  let start = 0;
  const push = (end) => {
    const dur = end - start;
    if (dur <= 0) return;
    const k = kind === 'speech' ? 'speech' : dur <= 0.35 ? 'micro_pause' : 'pause';
    segments.push({ kind: k, start: round(start), end: round(end), duration: round(dur) });
  };
  envelope.forEach((v, i) => {
    const k = v > 0.04 ? 'speech' : 'pause';
    if (k !== kind) {
      if (kind) push(i * hop);
      kind = k;
      start = i * hop;
    }
  });
  const duration = samples.length / wav.rate;
  if (kind) push(duration);

  const speechSegs = segments.filter((s) => s.kind === 'speech');
  const speechEnd = speechSegs.length ? speechSegs[speechSegs.length - 1].end : duration;
  return { rate: wav.rate, hop, duration: round(duration), speechEnd: round(speechEnd), envelope, segments };
}

const round = (n) => Math.round(n * 1000) / 1000;

// Limpa a saida das vozes clonadas (XTTS/Chatterbox costumam deixar silencios
// longos no meio e um "resto" curto de som depois de um silencio no final):
//  - som final curto (< 0.4 s) depois de pausa >= 0.6 s -> cortado
//  - pausas internas > 0.9 s -> encurtadas para 0.45 s
// Reescreve o arquivo (PCM 16 bits). Retorna {before, after} em segundos.
function tidyWav(file, { tailMax = 0.4, tailGap = 0.6, longPause = 0.9, keepPause = 0.45 } = {}) {
  const wav = readWav(fs.readFileSync(file));
  if (wav.bits !== 16) return null;
  const { segments, duration } = analyzeWav(file);
  const frameBytes = wav.channels * 2;
  const at = (t) => Math.min(wav.data.length, Math.round(t * wav.rate) * frameBytes);

  let end = duration;
  const speech = segments.filter((s) => s.kind === 'speech');
  if (speech.length >= 2) {
    // anda do fim para o comeco descartando "restos" curtos isolados
    for (let i = segments.length - 1; i > 0; i--) {
      const s = segments[i];
      if (s.kind !== 'speech') continue;
      const tail = segments.slice(i).filter((x) => x.kind === 'speech').reduce((a, x) => a + x.duration, 0);
      const gap = segments[i - 1];
      if (tail < tailMax && gap.kind === 'pause' && gap.duration >= tailGap) {
        end = gap.start + 0.15;
      }
      break;
    }
  }

  const parts = [];
  let cursor = 0;
  for (const s of segments) {
    if (s.start >= end) break;
    if (s.kind === 'pause' && s.duration > longPause && s.end < end) {
      const cutFrom = s.start + keepPause / 2;
      const cutTo = s.end - keepPause / 2;
      parts.push(wav.data.subarray(at(cursor), at(cutFrom)));
      cursor = cutTo;
    }
  }
  parts.push(wav.data.subarray(at(cursor), at(end)));
  const data = Buffer.concat(parts);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(wav.channels, 22);
  header.writeUInt32LE(wav.rate, 24);
  header.writeUInt32LE(wav.rate * frameBytes, 28);
  header.writeUInt16LE(frameBytes, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return { before: round(duration), after: round(data.length / frameBytes / wav.rate) };
}

module.exports = { analyzeWav, readWav, tidyWav };
