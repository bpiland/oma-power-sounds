#!/usr/bin/env python3
"""Power cues: dark analog 'vocal' bed + muted bells.

Nightcall-shaped: minor, mid-range, chorused, band-limited. Not an Apple
chime clone. Filter never opens into sparkle.

    python3 scripts/generate_sounds.py
"""

import math
import os
import struct
import wave

RATE = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "sounds")

# Motif in Hz — E minor. Lower and darker than the previous G / major-sixth stack.
ROOT = 164.81         # E3, vocoder-ish chest
MINOR_THIRD = 196.00  # G3
FLAT_SIXTH = 261.63   # C4, minor sixth above E


def env(t, dur, attack=0.008, release=0.12):
    if t < 0 or t > dur:
        return 0.0
    if attack > 0 and t < attack:
        return t / attack
    if release > 0 and t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


def exp_decay(t, tau):
    if t < 0:
        return 0.0
    return math.exp(-t / tau)


def lerp(a, b, frac):
    return a + (b - a) * min(1.0, max(0.0, frac))


def tanh_sat(x, amount=0.55):
    k = 1.0 + amount
    return math.tanh(x * k) / math.tanh(k)


class OnePole:
    def __init__(self, cutoff_hz):
        self.y = 0.0
        self.set(cutoff_hz)

    def set(self, cutoff_hz):
        cutoff_hz = max(40.0, min(cutoff_hz, RATE * 0.45))
        a = math.exp(-2.0 * math.pi * cutoff_hz / RATE)
        self.b = 1.0 - a
        self.a = a

    def proc(self, x):
        self.y = self.b * x + self.a * self.y
        return self.y


def analog_partials(phase):
    """Dark analog: fundamental, quiet octave, almost no buzz."""
    return math.sin(phase) + 0.14 * math.sin(phase * 2.0)


def analog_sample(phases):
    return (
        analog_partials(phases[0])
        + analog_partials(phases[1])
        + analog_partials(phases[2])
    ) / 3.0


def bell_clip(dur, freqs, taus, gains):
    """Decaying sines. Longer tau = more 'chime', shorter = more 'blip'."""
    n = int(RATE * dur)
    out = [0.0] * n
    phases = [0.0] * len(freqs)
    for i in range(n):
        t = i / RATE
        v = 0.0
        for k, freq in enumerate(freqs):
            phases[k] += 2.0 * math.pi * freq / RATE
            v += math.sin(phases[k]) * gains[k] * exp_decay(t, taus[k])
        v *= env(t, dur, attack=0.004, release=0.08)
        out[i] = v
    return out


def mix(total_dur, tracks):
    n = int(RATE * total_dur)
    out = [0.0] * n
    for start, clip in tracks:
        off = int(start * RATE)
        for i, v in enumerate(clip):
            j = off + i
            if 0 <= j < n:
                out[j] += v
    return out


def analog_bed(dur, freq, start_cut, end_cut, gain=0.55, attack=0.024, release=0.26,
               delay_mix=0.28, delay_s=0.014, detune=15.0):
    """Chorused, band-limited pad — Nightcall vocoder more than a lead."""
    n = int(RATE * dur)
    out = [0.0] * n
    lp = OnePole(start_cut)
    hp = OnePole(140.0)
    phases = [0.0, 0.0, 0.0]
    ratios = [
        1.0,
        2.0 ** (-detune / 1200.0),
        2.0 ** ((detune + 3.0) / 1200.0),
    ]
    delay = [0.0] * max(1, int(RATE * delay_s))
    di = 0
    for i in range(n):
        t = i / RATE
        frac = t / dur if dur else 1.0
        lp.set(lerp(start_cut, end_cut, frac ** 0.7))
        for k, ratio in enumerate(ratios):
            phases[k] += 2.0 * math.pi * freq * ratio / RATE
        v = analog_sample(phases)
        v = lp.proc(v)
        v = v - hp.proc(v)
        v = tanh_sat(v * 1.25, 0.85)
        echo = delay[di]
        delay[di] = v
        di = (di + 1) % len(delay)
        v = v + delay_mix * echo
        out[i] = v * env(t, dur, attack, release) * gain
    return out


def normalize(samples, peak=0.86):
    m = max((abs(v) for v in samples), default=1.0)
    scale = peak / m if m > 0 else 1.0
    return [v * scale for v in samples]


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(
            b"".join(
                struct.pack("<h", max(-32767, min(32767, int(v * 32767))))
                for v in samples
            )
        )


def ac_online():
    # Two-step up: E, then G. Filter opens. "Connected."
    return normalize(mix(0.48, [
        (0.00, analog_bed(0.22, ROOT, 160, 900, gain=0.72, attack=0.012, release=0.10,
                          delay_mix=0.18)),
        (0.16, analog_bed(0.30, MINOR_THIRD, 280, 1400, gain=0.70, attack=0.01, release=0.16,
                          delay_mix=0.22)),
        (0.28, bell_clip(0.18, [FLAT_SIXTH], [0.12], [0.28])),
    ]))


def ac_offline():
    # One drop: G down to E. Filter slams shut. "Disconnected."
    return normalize(mix(0.38, [
        (0.00, analog_bed(0.16, MINOR_THIRD, 1200, 400, gain=0.62, attack=0.006, release=0.08,
                          delay_mix=0.10, delay_s=0.008)),
        (0.12, analog_bed(0.24, ROOT, 500, 120, gain=0.78, attack=0.008, release=0.14,
                          delay_mix=0.08, delay_s=0.008)),
    ]))


def battery_low():
    # Dry double stab, no pad, no bells. Vocoder "hey. hey."
    stab = dict(start_cut=320, end_cut=380, attack=0.006, release=0.07,
                delay_mix=0.0, detune=22.0)
    return normalize(mix(0.42, [
        (0.00, analog_bed(0.14, ROOT, gain=0.82, **stab)),
        (0.18, analog_bed(0.16, ROOT * 0.94, gain=0.78, **stab)),
    ]))


def battery_full():
    # Sung cadence E–G–C. Longest, most chorused. "Done."
    return normalize(mix(0.78, [
        (0.00, analog_bed(0.28, ROOT, 150, 800, gain=0.62, attack=0.02, release=0.14,
                          delay_mix=0.32, delay_s=0.018)),
        (0.22, analog_bed(0.28, MINOR_THIRD, 180, 1000, gain=0.64, attack=0.02, release=0.14,
                          delay_mix=0.34, delay_s=0.018)),
        (0.44, analog_bed(0.34, FLAT_SIXTH, 200, 1200, gain=0.70, attack=0.018, release=0.20,
                          delay_mix=0.38, delay_s=0.020)),
        (0.48, bell_clip(0.28, [FLAT_SIXTH], [0.20], [0.22])),
    ]))


CUES = {
    "ac-online": ac_online,
    "ac-offline": ac_offline,
    "battery-low": battery_low,
    "battery-full": battery_full,
}


def main():
    out = os.path.abspath(OUT_DIR)
    for name, fn in CUES.items():
        path = os.path.join(out, name + ".wav")
        write_wav(path, fn())
        print(path)


if __name__ == "__main__":
    main()
