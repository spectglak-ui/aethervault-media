#!/usr/bin/env python3
"""
Génère les sons d'interface d'AetherVault Media (apps/desktop/public/sounds/ui/*.wav).

Pourquoi un script plutôt que des fichiers « opaques » : chaque son est décrit
ici par ses notes, ses enveloppes et sa réverbération. On peut donc le
retoucher (plus doux, plus grave, plus court…) puis régénérer, sans outil
audio ni licence tierce : tout est synthétisé, aucun échantillon externe.

Charte sonore (« moderne et premium », jamais agressive) :
  - tonalité : gamme pentatonique de ré majeur (D E F# A B) — toutes les notes
    s'accordent entre elles, quel que soit l'ordre dans lequel les sons
    s'enchaînent ;
  - timbres : cloches/verre (partiels inharmoniques, attaque douce) plutôt que
    des bips carrés ; aucune énergie au-delà de ~7 kHz ;
  - dynamique : les sons fréquents (clic, navigation) sont courts et discrets,
    les sons rares (succès, déverrouillage, bienvenue) ont de la profondeur ;
  - chaque son est normalisé à un pic précis : le volume réglé dans les
    Paramètres reste cohérent d'un son à l'autre.

Usage :  python3 scripts/generate-ui-sounds.py            (écrit les .wav)
         python3 scripts/generate-ui-sounds.py --report   (affiche aussi le bilan)
Dépendances : numpy, scipy.
"""
import argparse
import os

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "apps", "desktop", "public", "sounds", "ui")

# Gamme pentatonique de ré majeur
D4, E4, Fs4, A4, B4 = 293.66, 329.63, 369.99, 440.00, 493.88
D5, E5, Fs5, A5, B5 = 587.33, 659.25, 739.99, 880.00, 987.77
D6, E6, Fs6, A6 = 1174.66, 1318.51, 1479.98, 1760.00
D7 = 2349.32

rng = np.random.default_rng(7)


# ---------------------------------------------------------------- primitives
def tt(duration):
    return np.arange(int(duration * SR)) / SR


def sweep_phase(f0, f1, duration, exp=True):
    """Phase d'une sinusoïde dont la fréquence glisse de f0 à f1."""
    t = tt(duration)
    if exp:
        freq = f0 * (f1 / f0) ** (t / duration)
    else:
        freq = f0 + (f1 - f0) * t / duration
    return 2 * np.pi * np.cumsum(freq) / SR


def bell(freq, duration, tau, partials=None, attack=0.002):
    """Cloche/verre : partiels inharmoniques qui s'éteignent à des vitesses différentes."""
    partials = partials or [(1.0, 1.0, 1.0), (2.0, 0.32, 1.7), (2.76, 0.10, 2.4), (5.4, 0.04, 3.4)]
    t = tt(duration)
    out = np.zeros_like(t)
    for ratio, amp, decay in partials:
        f = freq * ratio
        if f > 9000:
            continue
        out += amp * np.sin(2 * np.pi * f * t) * np.exp(-t * decay / tau)
    a = max(1, int(attack * SR))
    out[:a] *= np.linspace(0, 1, a)
    return out


def swell(x, attack, release=None):
    n = len(x)
    env = np.ones(n)
    a = max(1, int(attack * SR))
    env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if release:
        r = max(1, int(release * SR))
        env[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return x * env


def bandpass_noise(duration, f_start, f_end, q=2.0, block=64):
    """Bruit filtré dont la bande centrale glisse (souffle, « whoosh » doux)."""
    n = int(duration * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    zi = None
    for i in range(0, n, block):
        frac = i / max(1, n - 1)
        fc = f_start * (f_end / f_start) ** frac
        low, high = fc * (1 - 0.5 / q), fc * (1 + 0.5 / q)
        sos = signal.butter(2, [max(40, low), min(high, SR * 0.45)], "band", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        seg, zi = signal.sosfilt(sos, noise[i : i + block], zi=zi)
        out[i : i + block] = seg
    return out / (np.max(np.abs(out)) + 1e-9)


def lowpass(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "low", fs=SR, output="sos"), x)


def highpass(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def click(duration=0.0025, lo=2000, hi=7000):
    n = int(duration * SR)
    burst = rng.standard_normal(n) * np.hanning(n)
    return signal.sosfilt(signal.butter(2, [lo, hi], "band", fs=SR, output="sos"), burst)


def reverb(x, rt=0.3, mix=0.15):
    """Petite réverbération diffuse (bruit à décroissance exponentielle) : de l'air, pas un écho."""
    n = int(rt * SR * 1.3)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (rt * SR * 0.35))
    ir = lowpass(ir, 6000)
    ir[0] = 0
    wet = signal.fftconvolve(x, ir)
    wet /= np.max(np.abs(wet)) + 1e-9
    wet *= np.max(np.abs(x)) * mix * 3.0
    out = np.zeros(max(len(x), len(wet)))
    out[: len(x)] += x
    out += wet[: len(out)] if len(wet) >= len(out) else np.pad(wet, (0, len(out) - len(wet)))
    return out


def place(buf, sig, at, gain=1.0):
    """Pose un élément sur le canevas ; si le canevas le coupe, la fin est
    adoucie (fondu de 10 ms) pour ne jamais produire de clic."""
    i = int(at * SR)
    end = min(len(buf), i + len(sig))
    seg = sig[: end - i].astype(float).copy()
    fade = min(len(seg), int(0.010 * SR))
    if fade > 1:
        seg[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    buf[i:end] += gain * seg


def finish(x, peak_db, fade_out=0.012):
    """Fondu d'entrée/sortie (pas de clic) puis normalisation au pic voulu."""
    x = x.copy()
    a = int(0.0008 * SR)
    x[:a] *= np.linspace(0, 1, a)
    r = int(fade_out * SR)
    x[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    x -= np.mean(x)
    x = highpass(x, 60, 1)
    x *= 10 ** (peak_db / 20) / (np.max(np.abs(x)) + 1e-9)
    return x


def canvas(duration):
    return np.zeros(int(duration * SR))


# --------------------------------------------------------------------- sons
def s_tap():
    b = canvas(0.10)
    body = np.sin(sweep_phase(1750, 1450, 0.10)) * np.exp(-tt(0.10) / 0.014)
    body += 0.25 * np.sin(2 * np.pi * 3480 * tt(0.10)) * np.exp(-tt(0.10) / 0.008)
    place(b, body, 0)
    place(b, click(), 0, 0.35)
    return finish(b, -10)


def s_tap_primary():
    b = canvas(0.20)
    place(b, bell(990, 0.20, 0.06), 0)
    place(b, bell(1485, 0.18, 0.05), 0, 0.5)
    place(b, np.sin(2 * np.pi * 495 * tt(0.15)) * np.exp(-tt(0.15) / 0.04), 0, 0.3)
    place(b, click(), 0, 0.25)
    return finish(reverb(b, 0.07, 0.10), -8, 0.05)


def s_select():
    b = canvas(0.13)
    t = tt(0.13)
    body = np.sin(sweep_phase(620, 1240, 0.13)) * np.exp(-t / 0.03)
    body += 0.2 * np.sin(2 * np.pi * 2 * 1000 * t) * np.exp(-t / 0.02)
    place(b, body, 0)
    return finish(b, -10)


def s_toggle_on():
    b = canvas(0.26)
    place(b, bell(E5, 0.24, 0.05), 0)
    place(b, bell(B5, 0.20, 0.06), 0.07)
    return finish(reverb(b, 0.08, 0.10), -8, 0.05)


def s_toggle_off():
    b = canvas(0.24)
    place(b, bell(B5, 0.2, 0.045, [(1, 1, 1), (2, 0.15, 2)]), 0, 0.8)
    place(b, bell(E5, 0.2, 0.055, [(1, 1, 1), (2, 0.15, 2)]), 0.065, 0.9)
    return finish(reverb(b, 0.07, 0.08), -9, 0.05)


def s_nav():
    b = canvas(0.20)
    whoosh = bandpass_noise(0.19, 500, 2400, q=1.6)
    place(b, swell(whoosh * np.sin(np.linspace(0, np.pi, len(whoosh))) ** 2, 0.02), 0, 0.8)
    place(b, bell(1180, 0.12, 0.03, [(1, 1, 1)]), 0.09, 0.18)
    return finish(b, -14)


def s_open():
    b = canvas(0.30)
    t = tt(0.26)
    rise = np.sin(sweep_phase(480, 820, 0.26)) * np.sin(np.linspace(0, np.pi, len(t))) ** 1.5
    place(b, rise, 0, 0.8)
    place(b, bandpass_noise(0.24, 1000, 4000, q=1.2) * np.sin(np.linspace(0, np.pi, int(0.24 * SR))) ** 2, 0, 0.10)
    place(b, bell(A6, 0.18, 0.05, [(1, 1, 1)]), 0.11, 0.20)
    return finish(reverb(b, 0.08, 0.10), -10, 0.05)


def s_close():
    b = canvas(0.22)
    t = tt(0.18)
    fall = np.sin(sweep_phase(820, 460, 0.18)) * np.sin(np.linspace(0, np.pi, len(t))) ** 1.5
    place(b, fall, 0, 0.8)
    place(b, bandpass_noise(0.16, 3000, 800, q=1.2) * np.sin(np.linspace(0, np.pi, int(0.16 * SR))) ** 2, 0, 0.08)
    return finish(b, -12)


def s_success():
    b = canvas(0.65)
    for i, f in enumerate((D5, Fs5, A5, D6)):
        place(b, bell(f, 0.6, 0.13), i * 0.06, 0.75 + 0.08 * i)
    return finish(reverb(b, 0.30, 0.20), -8, 0.12)


def s_error():
    b = canvas(0.42)
    for f, at, tau, g in ((Fs4, 0.0, 0.06, 1.0), (D4, 0.10, 0.10, 1.0)):
        t = tt(0.3)
        note = (np.sin(2 * np.pi * f * t) + 0.35 * signal.sawtooth(2 * np.pi * f * t, 0.5)) * np.exp(-t / tau)
        place(b, note, at, g)
    b = lowpass(b, 1400)
    return finish(reverb(b, 0.10, 0.08), -9, 0.08)


def s_notify():
    b = canvas(0.75)
    place(b, bell(A5, 0.7, 0.18), 0)
    place(b, bell(E6, 0.6, 0.16), 0.09, 0.8)
    return finish(reverb(b, 0.3, 0.2), -8, 0.12)


def s_favorite():
    b = canvas(0.5)
    for i, f in enumerate((A5, D6, Fs6, A6)):
        place(b, bell(f, 0.32, 0.06), i * 0.045, 0.85)
    place(b, bell(3520, 0.25, 0.04, [(1, 1, 1)]), 0.13, 0.15)
    return finish(reverb(b, 0.18, 0.16), -9, 0.08)


def s_delete():
    b = canvas(0.38)
    t = tt(0.22)
    swoosh = bandpass_noise(0.22, 2200, 250, q=0.9) * np.exp(-t / 0.09)
    place(b, swoosh, 0, 0.9)
    thump = np.sin(sweep_phase(150, 60, 0.15)) * np.exp(-tt(0.15) / 0.05)
    place(b, thump, 0, 0.7)
    return finish(b, -10, 0.05)


def s_unlock():
    b = canvas(1.0)
    pad = canvas(0.9)
    for f in (D4, A4, D5):
        pad += np.sin(2 * np.pi * f * tt(0.9))
    place(b, swell(pad, 0.15, 0.4), 0, 0.12)
    for i, f in enumerate((D5, A5, Fs6)):
        place(b, bell(f, 0.9, 0.22), i * 0.09, 0.8)
    return finish(reverb(b, 0.45, 0.25), -8, 0.2)


def s_lock():
    b = canvas(0.42)
    place(b, bell(A5, 0.3, 0.08), 0, 0.9)
    place(b, bell(D5, 0.33, 0.11), 0.085)
    place(b, np.sin(sweep_phase(130, 70, 0.12)) * np.exp(-tt(0.12) / 0.04), 0.085, 0.5)
    return finish(reverb(b, 0.12, 0.10), -9, 0.08)


def s_welcome():
    b = canvas(1.8)
    pad = canvas(1.5)
    for f in (D4, A4, D5, Fs5):
        pad += np.sin(2 * np.pi * f * tt(1.5)) + 0.3 * np.sin(2 * np.pi * 2 * f * tt(1.5))
    place(b, swell(pad, 0.3, 0.8), 0, 0.10)
    place(b, swell(np.sin(2 * np.pi * 146.83 * tt(1.5)), 0.35, 0.7), 0, 0.28)
    for i, f in enumerate((D6, Fs6, A6, D7)):
        place(b, bell(f, 1.1, 0.22), 0.32 + i * 0.07, 0.55)
    return finish(reverb(b, 0.6, 0.28), -8, 0.4)


def s_play():
    b = canvas(0.45)
    t = tt(0.22)
    rise = np.sin(sweep_phase(330, 660, 0.22)) * np.sin(np.linspace(0, np.pi, len(t))) ** 1.2
    place(b, rise, 0, 0.8)
    place(b, bell(A5, 0.3, 0.10), 0.12, 0.8)
    place(b, np.sin(2 * np.pi * 165 * tt(0.2)) * np.exp(-tt(0.2) / 0.08), 0, 0.4)
    return finish(reverb(b, 0.2, 0.10), -9, 0.08)


def s_hover():
    b = canvas(0.04)
    t = tt(0.04)
    place(b, np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.006), 0)
    return finish(b, -26, 0.008)


def s_copy():
    b = canvas(0.20)
    for at, f in ((0.0, 1500), (0.05, 2000)):
        t = tt(0.07)
        place(b, np.sin(2 * np.pi * f * t) * np.exp(-t / 0.012), at)
        place(b, click(0.002), at, 0.25)
    return finish(b, -11)


SOUNDS = {
    "tap": s_tap, "tap-primary": s_tap_primary, "select": s_select,
    "toggle-on": s_toggle_on, "toggle-off": s_toggle_off, "nav": s_nav,
    "open": s_open, "close": s_close, "success": s_success, "error": s_error,
    "notify": s_notify, "favorite": s_favorite, "delete": s_delete,
    "unlock": s_unlock, "lock": s_lock, "welcome": s_welcome, "play": s_play,
    "hover": s_hover, "copy": s_copy,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true", help="affiche durée, pic, niveau et brillance de chaque son")
    args = parser.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for name, fn in SOUNDS.items():
        x = fn()
        assert np.max(np.abs(x)) <= 1.0, f"{name} écrête"
        pcm = (x * 32767).astype(np.int16)
        path = os.path.join(OUT_DIR, f"{name}.wav")
        wavfile.write(path, SR, pcm)
        total += os.path.getsize(path)
        if args.report:
            spec = np.abs(np.fft.rfft(x))
            freqs = np.fft.rfftfreq(len(x), 1 / SR)
            centroid = float((spec * freqs).sum() / (spec.sum() + 1e-9))
            rms = 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-9)
            print(f"{name:12s} {len(x) / SR * 1000:6.0f} ms  pic {20 * np.log10(np.max(np.abs(x))):6.1f} dBFS  "
                  f"rms {rms:6.1f} dBFS  centroïde {centroid:6.0f} Hz")
    print(f"{len(SOUNDS)} sons écrits dans {os.path.abspath(OUT_DIR)} ({total // 1024} Ko)")


if __name__ == "__main__":
    main()
