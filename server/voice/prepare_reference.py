"""Converte o audio de referencia da voz para o formato usado pelos modelos.

Uso: python prepare_reference.py <entrada (mp3/wav/...)> <saida.wav>

Saida: WAV mono, 16 bits, 22050 Hz, sem silencio nas pontas, sem ruido grave
(passa-altas 80 Hz) e com pico em -1 dBFS. XTTS e Chatterbox aceitam esse
formato; o ideal e de 6 a 30 s de fala limpa de uma pessoa so.
"""
import sys

import numpy as np
import soundfile as sf
import soxr
from scipy.signal import butter, sosfiltfilt

TARGET_SR = 22050
PEAK = 10 ** (-1 / 20)  # -1 dBFS
MAX_SECONDS = 30.0


def trim_silence(x: np.ndarray, sr: int, threshold_db: float = -40.0) -> np.ndarray:
    win = int(sr * 0.02)
    frames = max(1, len(x) // win)
    rms = np.array([np.sqrt(np.mean(x[i * win:(i + 1) * win] ** 2) + 1e-12) for i in range(frames)])
    level = 20 * np.log10(rms / (np.max(rms) + 1e-12))
    voiced = np.where(level > threshold_db)[0]
    if voiced.size == 0:
        return x
    start = max(0, voiced[0] * win - int(0.05 * sr))
    end = min(len(x), (voiced[-1] + 1) * win + int(0.10 * sr))
    return x[start:end]


def main(src: str, dst: str) -> None:
    data, sr = sf.read(src, always_2d=True)
    mono = data.mean(axis=1).astype(np.float64)
    sos = butter(4, 80, btype="highpass", fs=sr, output="sos")
    mono = sosfiltfilt(sos, mono)
    mono = soxr.resample(mono, sr, TARGET_SR)
    mono = trim_silence(mono, TARGET_SR)
    if len(mono) > MAX_SECONDS * TARGET_SR:
        mono = mono[: int(MAX_SECONDS * TARGET_SR)]
    mono = mono / (np.max(np.abs(mono)) + 1e-9) * PEAK
    sf.write(dst, mono.astype(np.float32), TARGET_SR, subtype="PCM_16")
    print(f"{src} -> {dst}: {len(mono) / TARGET_SR:.1f} s, {TARGET_SR} Hz mono 16 bits (original {sr} Hz, {data.shape[1]} canais)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
