#!/usr/bin/env python3
"""
Generates the game's sound assets into public/sounds/.

These are synthesised offline with physical modelling rather than played as raw
oscillators in the browser:

  * struck plastic ball  -> band-passed noise burst + fast decaying modes
  * wooden wall knock    -> inharmonic modal sum with power-law decay
  * metal rod clack      -> high inharmonic modes + broadband transient
  * crowd                -> formant-filtered noise beds, amplitude-modulated
                            by many independent "voices"

Output: 22.05 kHz mono 16-bit WAV (universally decodable, small).

Run:  python3 tools/gen_sounds.py
"""
import math
import os
import wave

import numpy as np

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "sounds")
rng = np.random.default_rng(20261124)


# --------------------------------------------------------------------- helpers
def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def noise(n):
    return rng.standard_normal(n)


def onepole_lp(x, cutoff):
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = a * acc + (1 - a) * v
        y[i] = acc
    return y


def onepole_hp(x, cutoff):
    return x - onepole_lp(x, cutoff)


def biquad(x, kind, f0, q=0.707, gain_db=0.0):
    """RBJ cookbook biquad — used for band-pass and peaking voice filters."""
    w0 = 2 * math.pi * f0 / SR
    cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
    alpha = sin_w0 / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "bp":  # constant skirt gain
        b0, b1, b2 = sin_w0 / 2, 0, -sin_w0 / 2
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    elif kind == "peak":
        b0, b1, b2 = 1 + alpha * A, -2 * cos_w0, 1 - alpha * A
        a0, a1, a2 = 1 + alpha / A, -2 * cos_w0, 1 - alpha / A
    elif kind == "lp":
        b0, b1, b2 = (1 - cos_w0) / 2, 1 - cos_w0, (1 - cos_w0) / 2
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    elif kind == "hp":
        b0, b1, b2 = (1 + cos_w0) / 2, -(1 + cos_w0), (1 + cos_w0) / 2
        a0, a1, a2 = 1 + alpha, -2 * cos_w0, 1 - alpha
    else:
        raise ValueError(kind)
    b0, b1, b2 = b0 / a0, b1 / a0, b2 / a0
    a1, a2 = a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, o
        y[i] = o
    return y


def modal(dur, modes, noise_amt=0.0, noise_cut=3000, attack=0.001):
    """Sum of exponentially damped sinusoids -> struck-object resonance."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for freq, amp, decay in modes:
        # slight detune drift makes it sound like a real struck object, not a sine
        f = freq * (1 + rng.uniform(-0.004, 0.004))
        out += amp * np.sin(2 * math.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-decay * t)
    if noise_amt:
        nz = biquad(noise(n), "bp", noise_cut, 0.9)
        out += noise_amt * nz * np.exp(-t * 900)
    env = np.minimum(1.0, t / max(attack, 1e-5))
    return out * env


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def fade(x, ms=4):
    n = int(SR * ms / 1000)
    if n <= 0:
        return x
    if len(x) > 2 * n:
        x[:n] *= np.linspace(0, 1, n)
        x[-n:] *= np.linspace(1, 0, n)
    return x


def norm(x, peak=0.92):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def write(name, x, peak=0.92, fade_ms=4):
    os.makedirs(OUT, exist_ok=True)
    x = norm(np.asarray(x, dtype=np.float64), peak)
    x = fade(x, fade_ms)
    data = np.clip(x * 32767, -32768, 32767).astype("<i2")
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f"  {name:22s} {len(data)/SR:5.2f}s  {os.path.getsize(path)//1024:4d} KB")


# ------------------------------------------------------------------- the sounds
def ball_hit(power):
    """Celluloid ball struck by a figure: bright, very short, pitch rises with power."""
    dur = 0.16
    t = t_axis(dur)
    base = 900 + 700 * power
    # body resonance of a hollow plastic sphere
    body = modal(
        dur,
        [
            (base, 0.5, 90),
            (base * 2.31, 0.26, 130),
            (base * 3.79, 0.14, 190),
            (base * 5.2, 0.07, 260),
        ],
        noise_amt=0.55 + 0.3 * power,
        noise_cut=2600 + 1800 * power,
    )
    # attack click
    click = biquad(noise(len(t)), "hp", 4200, 0.9) * np.exp(-t * 700)
    x = body + 0.35 * click
    x *= np.exp(-t * (14 - 6 * power))
    return soft_clip(x * (0.6 + 0.7 * power), 1.2)


def wall_knock(power):
    """Ball hitting the wooden rail: low, woody, inharmonic."""
    dur = 0.28
    t = t_axis(dur)
    f0 = 190 + 40 * rng.uniform()
    x = modal(
        dur,
        [
            (f0, 0.6, 26),
            (f0 * 2.62, 0.3, 40),
            (f0 * 4.71, 0.18, 62),
            (f0 * 7.3, 0.09, 95),
        ],
        noise_amt=0.4, noise_cut=1400,
    )
    return soft_clip(x * (0.45 + 0.6 * power), 1.1)


def rod_clack():
    """Metal rod bottoming out against its stop — metallic, short ring."""
    dur = 0.3
    t = t_axis(dur)
    f0 = 1150 * rng.uniform(0.95, 1.05)
    x = modal(
        dur,
        [
            (f0, 0.4, 42),
            (f0 * 1.86, 0.3, 55),
            (f0 * 2.94, 0.22, 70),
            (f0 * 4.6, 0.12, 95),
            (f0 * 6.9, 0.06, 130),
        ],
        noise_amt=0.5, noise_cut=5200,
    )
    return soft_clip(x * 0.8, 1.0)


def goal_net():
    """Ball rippling into a nylon net."""
    dur = 0.5
    t = t_axis(dur)
    nz = biquad(noise(len(t)), "bp", 1700, 0.6) * np.exp(-t * 9)
    swish = biquad(noise(len(t)), "bp", 5200, 0.5) * np.exp(-t * 16) * 0.5
    thud = modal(0.3, [(240, 0.5, 22), (430, 0.25, 34)], noise_amt=0.3, noise_cut=900)
    x = nz + swish
    x[: len(thud)] += thud * 0.7
    return x * 0.7


def crowd(dur=6.0, voices=46, intensity=0.55, seed=3):
    """
    A crowd bed: many independent band-limited noise 'voices' with formants,
    each with its own slow random envelope. Loops seamlessly by crossfading the
    tail into the head.
    """
    r = np.random.default_rng(seed)
    n = int(SR * dur)
    mix = np.zeros(n)
    for _ in range(voices):
        # each voice: noise -> formant peaks -> slow envelope
        v = noise(n)
        f1 = r.uniform(280, 780)      # vowel formants
        f2 = r.uniform(900, 2400)
        v = biquad(v, "peak", f1, 3.2, 10.0)
        v = biquad(v, "peak", f2, 4.0, 6.0)
        v = biquad(v, "bp", r.uniform(300, 1100), 0.7)
        # slow amplitude wander (speech-like syllable rate 2-6 Hz)
        rate = r.uniform(1.5, 5.5)
        phase = r.uniform(0, 6.28)
        env = 0.55 + 0.45 * np.sin(2 * math.pi * rate * np.arange(n) / SR + phase)
        env *= np.clip(r.normal(1.0, 0.25, n).cumsum() / 40 + 1, 0.15, 2.2)
        mix += v * env * r.uniform(0.35, 1.0)
    mix = biquad(mix, "lp", 3400, 0.7)
    mix = biquad(mix, "hp", 120, 0.7)
    # seamless loop: crossfade last 12% into the first 12%
    xf = int(n * 0.12)
    head, tail = mix[:xf].copy(), mix[-xf:].copy()
    ramp = np.linspace(0, 1, xf)
    mix[:xf] = head * ramp + tail * (1 - ramp)
    mix = mix[:-xf]
    mix *= intensity
    # ambient room tone underneath
    room = biquad(noise(len(mix)), "lp", 480, 0.7) * 0.5
    return mix + room


def cheer(dur=2.6, voices=70, seed=11):
    """A goal celebration: noise swell with rising then falling intensity."""
    r = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR
    mix = np.zeros(n)
    for _ in range(voices):
        v = noise(n)
        v = biquad(v, "peak", r.uniform(400, 1600), 3.0, 9.0)
        v = biquad(v, "bp", r.uniform(500, 2200), 0.8)
        # each person arrives a bit late and leaves a bit late
        delay = int(r.uniform(0, 0.35) * SR)
        v = np.concatenate([np.zeros(delay), v])[:n]
        climb = np.clip((t - r.uniform(0, 0.4)) / r.uniform(0.15, 0.5), 0, 1)
        fall = np.exp(-np.maximum(0, t - r.uniform(0.7, 1.6)) * r.uniform(1.2, 3.0))
        mix += v * climb * fall * r.uniform(0.4, 1.0)
    mix = biquad(mix, "lp", 4200, 0.7)
    mix = biquad(mix, "hp", 260, 0.7)
    # air-horn-ish brightness + applause band
    applause = biquad(noise(n), "bp", 2600, 0.5)
    ap_env = np.exp(-np.maximum(0, t - 0.35) * 2.2) * np.clip(t / 0.25, 0, 1)
    ap_env *= 0.5 + 0.5 * np.abs(np.sin(2 * math.pi * 7.5 * t))
    mix = mix + applause * ap_env * 0.35
    return mix


def whistle(dur=0.62, trill=26.0, seed=5):
    """Pea whistle: two close tones + the pea's amplitude trill + breath noise."""
    r = np.random.default_rng(seed)
    t = t_axis(dur)
    f_lo, f_hi = 2180, 2760
    vib = 1 + 0.012 * np.sin(2 * math.pi * 5.5 * t)
    tone = 0.55 * np.sin(2 * math.pi * f_lo * t * vib) + 0.45 * np.sin(2 * math.pi * f_hi * t * vib)
    pea = 0.55 + 0.45 * np.abs(np.sin(2 * math.pi * trill * t + r.uniform(0, 3)))
    tone *= pea
    breath = biquad(noise(len(t)), "bp", 2450, 2.0) * 0.22
    env = np.clip(t / 0.035, 0, 1) * np.clip((dur - t) / 0.10, 0, 1)
    return (tone + breath) * env


def beep(freq=880, dur=0.1):
    t = t_axis(dur)
    x = np.sin(2 * math.pi * freq * t) + 0.25 * np.sin(2 * math.pi * freq * 2 * t)
    return x * np.clip(t / 0.004, 0, 1) * np.clip((dur - t) / 0.02, 0, 1)


def ui_click():
    t = t_axis(0.045)
    x = biquad(noise(len(t)), "bp", 2400, 1.2) * np.exp(-t * 150)
    x += 0.4 * np.sin(2 * math.pi * 1500 * t) * np.exp(-t * 190)
    return soft_clip(x, 1.0)


def ui_hover():
    t = t_axis(0.03)
    x = biquad(noise(len(t)), "bp", 3400, 1.6) * np.exp(-t * 200)
    return x * 0.45


def ui_success():
    out = []
    for i, f in enumerate([784, 988, 1319]):
        seg = beep(f, 0.13)
        out.append(np.concatenate([np.zeros(int(i * 0.055 * SR)), seg]))
    n = max(len(o) for o in out)
    x = sum(np.pad(o, (0, n - len(o))) for o in out) / 2
    return x


def coin():
    """Bright metallic spin-down — two inharmonic metals, quick."""
    t = t_axis(0.34)
    x = modal(0.34, [(2093, 0.5, 30), (2637, 0.35, 38), (3520, 0.2, 46)], noise_amt=0.15, noise_cut=6000)
    x *= np.exp(-t * 6)
    return x


def fanfare(seed=7):
    """Victory sting: brass-ish stacked saws with a hall tail."""
    r = np.random.default_rng(seed)
    notes = [(523.25, 0.0, 0.16), (659.25, 0.14, 0.16), (783.99, 0.28, 0.16), (1046.5, 0.42, 0.62)]
    dur = 1.5
    n = int(SR * dur)
    out = np.zeros(n)
    for freq, start, length in notes:
        ln = int(SR * length)
        t = np.arange(ln) / SR
        # brass-ish: fundamental + 2nd/3rd with a slow bloom
        v = (
            np.sin(2 * math.pi * freq * t)
            + 0.5 * np.sin(2 * math.pi * freq * 2 * t)
            + 0.28 * np.sin(2 * math.pi * freq * 3 * t)
            + 0.12 * np.sin(2 * math.pi * freq * 4.02 * t)
        )
        env = np.clip(t / 0.03, 0, 1) * np.clip((length - t) / 0.12, 0, 1)
        env *= 1 + 0.06 * np.sin(2 * math.pi * 5.2 * t)  # vibrato
        seg = v * env
        o = int(start * SR)
        out[o:o + ln] += seg[: min(ln, n - o)]
    # cheap hall: a few decaying noise-driven echoes
    tail = np.zeros(n)
    for d, g in [(0.085, 0.34), (0.17, 0.22), (0.28, 0.14), (0.41, 0.08)]:
        di = int(d * SR)
        tail[di:] += out[:-di] * g
    out = out + biquad(tail, "lp", 3000, 0.7)
    # crowd joins the celebration
    cr = cheer(1.4, voices=40, seed=21)
    out[: len(cr)] += cr[:n] * 0.35
    return out


def defeat():
    t_total = 1.5
    n = int(SR * t_total)
    out = np.zeros(n)
    for i, f in enumerate([392.0, 349.23, 293.66]):
        ln = int(SR * 0.5)
        t = np.arange(ln) / SR
        v = np.sin(2 * math.pi * f * t) + 0.4 * np.sin(2 * math.pi * f * 2 * t)
        env = np.clip(t / 0.04, 0, 1) * np.clip((0.5 - t) / 0.25, 0, 1)
        o = int(i * 0.22 * SR)
        out[o:o + ln] += (v * env)[: min(ln, n - o)]
    out = biquad(out, "lp", 2200, 0.7)
    return out * 0.8


def serve_flick():
    """Quick wrist-flick release of the ball."""
    t = t_axis(0.2)
    x = biquad(noise(len(t)), "bp", 1300, 0.9) * np.exp(-t * 22)
    x += 0.3 * np.sin(2 * math.pi * 620 * t) * np.exp(-t * 30)
    return x


def main():
    print("writing to", OUT)
    write("ball-soft", ball_hit(0.15), peak=0.7)
    write("ball-medium", ball_hit(0.55), peak=0.85)
    write("ball-hard", ball_hit(1.0), peak=0.95)
    write("wall-soft", wall_knock(0.2), peak=0.7)
    write("wall-hard", wall_knock(0.9), peak=0.95)
    write("rod-clack", rod_clack(), peak=0.8)
    write("goal-net", goal_net(), peak=0.9)
    write("serve", serve_flick(), peak=0.7)
    write("crowd-loop", crowd(7.0, intensity=0.5, seed=3), peak=0.75, fade_ms=0)
    write("crowd-tense", crowd(7.0, intensity=0.42, seed=9), peak=0.7, fade_ms=0)
    write("crowd-cheer", cheer(2.6, seed=11), peak=0.9)
    write("whistle-short", whistle(0.42, 26.0, seed=5), peak=0.85)
    write("whistle-long", whistle(0.95, 22.0, seed=6), peak=0.85)
    write("countdown", beep(720, 0.11), peak=0.6)
    write("kickoff-beep", beep(1080, 0.18), peak=0.65)
    write("ui-click", ui_click(), peak=0.55)
    write("ui-hover", ui_hover(), peak=0.3)
    write("ui-success", ui_success(), peak=0.7)
    write("coin", coin(), peak=0.7)
    write("victory", fanfare(), peak=0.92)
    write("defeat", defeat(), peak=0.8)


if __name__ == "__main__":
    main()
