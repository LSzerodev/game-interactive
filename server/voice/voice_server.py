"""Servidor local de voz clonada (XTTS v2 ou Chatterbox multilingue).

Uso:
  python voice_server.py --engine xtts       --port 8020
  python voice_server.py --engine chatterbox --port 8021

API (a mesma para os dois motores, usada por server/src/tts.js):
  GET  /health          -> {"engine": ..., "ready": true/false}
  POST /tts_to_audio/   {"text": "...", "speaker_wav": "C:/.../default.wav", "language": "pt"}
                        -> audio/wav (mono, 16 bits)

O modelo carrega uma vez na inicializacao. A "impressao" da voz de referencia
(latentes do XTTS / condicionais do Chatterbox) fica em cache por arquivo, entao
so a primeira fala com uma voz nova paga esse custo. Uma sintese por vez.

Licencas: XTTS v2 = Coqui Public Model License (NAO comercial); o servidor so
baixa o modelo com COQUI_TOS_AGREED=1. Chatterbox = MIT.
"""
import argparse
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import torch


class XttsEngine:
    sample_rate = 24000

    def __init__(self) -> None:
        if os.environ.get("COQUI_TOS_AGREED") != "1":
            sys.exit("XTTS v2 exige aceitar a Coqui Public Model License: defina COQUI_TOS_AGREED=1")
        from TTS.api import TTS

        # XTTS_DEVICE=cuda so faz sentido com uma placa NVIDIA de 8 GB ou mais (e o torch com CUDA).
        # Na RX 5500 XT de 4 GB nao cabe: o Windows, a IA e o jogo ja usam ~3 GB de video.
        self.tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(os.environ.get("XTTS_DEVICE", "cpu"))
        self.model = self.tts.synthesizer.tts_model
        self._cache: dict = {}
        if os.environ.get("XTTS_INT8") == "1":
            self._quantize_int8()

    def _quantize_int8(self) -> None:
        """Pesos do GPT em int8: ~36% mais rapido na CPU (2,15x -> 1,37x do tempo real),
        mas pronuncia pior (medido com Whisper: erro de palavras 3,2% -> 9,5%; 'Sonic'
        vira 'Sonipe'). Por isso fica DESLIGADO por padrao (XTTS_INT8=1 liga)."""
        from transformers.pytorch_utils import Conv1D

        def conv1d_to_linear(mod):
            for name, child in list(mod.named_children()):
                if isinstance(child, Conv1D):
                    lin = torch.nn.Linear(child.weight.shape[0], child.nf)
                    lin.weight.data = child.weight.data.t().contiguous()
                    lin.bias.data = child.bias.data.clone()
                    setattr(mod, name, lin)
                else:
                    conv1d_to_linear(child)

        conv1d_to_linear(self.model.gpt)
        self.model.gpt = torch.quantization.quantize_dynamic(self.model.gpt, {torch.nn.Linear}, dtype=torch.qint8)
        print("[voz] XTTS em int8 (mais rapido, pronuncia pior)", flush=True)

    def _latents(self, speaker_wav: str):
        key = (speaker_wav, os.path.getmtime(speaker_wav))
        if key not in self._cache:
            self._cache[key] = self.model.get_conditioning_latents(audio_path=[speaker_wav])
        return self._cache[key]

    def synthesize(self, text: str, speaker_wav: str, language: str) -> np.ndarray:
        gpt_cond, speaker_emb = self._latents(speaker_wav)
        out = self.model.inference(text, language, gpt_cond, speaker_emb, temperature=0.7, enable_text_splitting=True)
        return np.asarray(out["wav"], dtype=np.float32)



class ChatterboxEngine:
    def __init__(self) -> None:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        self.model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
        self.sample_rate = self.model.sr
        self._current = None

    def synthesize(self, text: str, speaker_wav: str, language: str) -> np.ndarray:
        key = (speaker_wav, os.path.getmtime(speaker_wav))
        if key != self._current:
            self.model.prepare_conditionals(speaker_wav)
            self._current = key
        wav = self.model.generate(text, language_id=language)
        return wav.squeeze(0).detach().cpu().numpy().astype(np.float32)


ENGINES = {"xtts": XttsEngine, "chatterbox": ChatterboxEngine}


def make_handler(engine, name: str, lock: threading.Lock):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # log curto no console
            sys.stdout.write("[voz] " + (fmt % args) + "\n")

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.rstrip("/") == "/health":
                return self._json(200, {"engine": name, "ready": True})
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/tts_to_audio":
                return self._json(404, {"error": "not found"})
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                text = str(req.get("text") or "").strip()
                speaker = str(req.get("speaker_wav") or "")
                language = str(req.get("language") or "pt")
                if not text:
                    return self._json(400, {"error": "texto vazio"})
                if not os.path.isfile(speaker):
                    return self._json(400, {"error": f"voz de referencia nao encontrada: {speaker}"})
                started = time.time()
                with lock:
                    wav = engine.synthesize(text, speaker, language)
                buf = io.BytesIO()
                sf.write(buf, np.clip(wav, -1.0, 1.0), engine.sample_rate, format="WAV", subtype="PCM_16")
                data = buf.getvalue()
                seconds = len(wav) / engine.sample_rate
                sys.stdout.write(f"[voz] {seconds:.1f} s de audio em {time.time() - started:.1f} s: {text[:60]}\n")
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as exc:  # erro vira 500 com a mensagem, o Node cai para outra voz
                self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=sorted(ENGINES), required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8020)
    ap.add_argument("--warmup-wav", default="", help="voz para pre-calcular o cache na inicializacao")
    args = ap.parse_args()

    # Threads: o XTTS e limitado pela memoria, nao pelo processador (medido: 4 threads = 6 = 12 em
    # velocidade). Usar so 4 deixa 2 nucleos livres para a IA (Ollama), o jogo e o OBS/TikTok Studio,
    # que ficavam disputando CPU com a voz e se atrasavam.
    torch.set_num_threads(max(1, int(os.environ.get("XTTS_THREADS", "4"))))
    t = time.time()
    print(f"[voz] carregando {args.engine}...", flush=True)
    engine = ENGINES[args.engine]()
    print(f"[voz] {args.engine} carregado em {time.time() - t:.1f} s", flush=True)
    lock = threading.Lock()
    if args.warmup_wav and os.path.isfile(args.warmup_wav):
        t = time.time()
        engine.synthesize("Oi, tudo bem?", args.warmup_wav, "pt")
        print(f"[voz] aquecido com a voz de referencia em {time.time() - t:.1f} s", flush=True)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine, args.engine, lock))
    print(f"[voz] pronto em http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
