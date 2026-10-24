import { describe, it, expect } from 'vitest';
import {
  REDSTONE_TICK_SECONDS,
  REDSTONE_TICKS_PER_SECOND,
  BASE_NOTE_PITCH_MIDI,
  MAX_NOTE_PITCH_MIDI,
  calculateNoteBlockPitchMultiplier,
  isValidNoteBlockPitch,
} from '../src/core/types';

describe('Milestone 1 Adversarial Challenge: Octave Folding & Boundary Invariants', () => {
  // Canonical while-loop folding implementation
  function foldMidiPitchWhile(pitch: number): number {
    let p = pitch;
    while (p < 54) p += 12;
    while (p > 78) p -= 12;
    return p - 54;
  }

  // Closed-form O(1) folding implementation
  function foldMidiPitchO1(pitch: number): number {
    let p = pitch;
    if (p < 54) {
      p += Math.ceil((54 - p) / 12) * 12;
    } else if (p > 78) {
      p -= Math.ceil((p - 78) / 12) * 12;
    }
    return p - 54;
  }

  it('should fold extreme negative and positive MIDI notes strictly into [0, 24]', () => {
    const extremeNotes = [
      -10000, -1200, -500, -100, -54, -12, -1,
      0, 1, 12, 24, 36, 48, 53,
      54, 60, 66, 72, 78,
      79, 84, 90, 102, 114, 127,
      128, 255, 500, 1000, 10000,
    ];

    for (const note of extremeNotes) {
      const foldedWhile = foldMidiPitchWhile(note);
      const foldedO1 = foldMidiPitchO1(note);

      // Invariant 1: Range bound containment [0, 24]
      expect(foldedWhile).toBeGreaterThanOrEqual(0);
      expect(foldedWhile).toBeLessThanOrEqual(24);
      expect(foldedO1).toBeGreaterThanOrEqual(0);
      expect(foldedO1).toBeLessThanOrEqual(24);

      // Invariant 2: Mathematical parity between while-loop and O(1) closed form
      expect(foldedO1).toBe(foldedWhile);

      // Invariant 3: Musical pitch-class preservation (modulo 12)
      // Mathematical modulo: ((x % 12) + 12) % 12
      const expectedPitchClass = ((note % 12) + 12) % 12;
      const actualPitchClass = (((foldedWhile + 54) % 12) + 12) % 12;
      expect(actualPitchClass).toBe(expectedPitchClass);
    }
  });

  it('should guarantee in-range notes [54, 78] are completely unaffected by folding', () => {
    for (let midi = BASE_NOTE_PITCH_MIDI; midi <= MAX_NOTE_PITCH_MIDI; midi++) {
      const expected = midi - BASE_NOTE_PITCH_MIDI;
      expect(foldMidiPitchWhile(midi)).toBe(expected);
      expect(foldMidiPitchO1(midi)).toBe(expected);
    }
  });

  it('should test boundary notes 53 and 79 for exact 1-octave wrapping', () => {
    // Note 53 is F3 (1 semitone below F#3=54). Folds +12 -> 65 (F4). 65 - 54 = 11.
    expect(foldMidiPitchWhile(53)).toBe(11);
    expect(foldMidiPitchO1(53)).toBe(11);
    expect(((11 + 54) % 12)).toBe(((53 % 12) + 12) % 12);

    // Note 79 is G5 (1 semitone above F#5=78). Folds -12 -> 67 (G4). 67 - 54 = 13.
    expect(foldMidiPitchWhile(79)).toBe(13);
    expect(foldMidiPitchO1(79)).toBe(13);
    expect(((13 + 54) % 12)).toBe(((79 % 12) + 12) % 12);
  });

  it('should stress-test exhaustive integer sweep from -500 to +500', () => {
    for (let n = -500; n <= 500; n++) {
      const folded = foldMidiPitchO1(n);
      expect(folded).toBeGreaterThanOrEqual(0);
      expect(folded).toBeLessThanOrEqual(24);
      const expectedPitchClass = ((n % 12) + 12) % 12;
      const actualPitchClass = (((folded + 54) % 12) + 12) % 12;
      expect(actualPitchClass).toBe(expectedPitchClass);
    }
  });
});

describe('Milestone 1 Adversarial Challenge: 3D Coordinate Bijection Math', () => {
  function encodeCoord(x: number, y: number, z: number, width: number, length: number): number {
    return (y * length + z) * width + x;
  }

  function decodeIndex(index: number, width: number, length: number): { x: number; y: number; z: number } {
    const x = index % width;
    const rem = Math.floor(index / width);
    const z = rem % length;
    const y = Math.floor(rem / length);
    return { x, y, z };
  }

  it('should prove strict bijectivity across realistic schematic volume (W=16, H=3, L=40)', () => {
    const W = 16;
    const H = 3;
    const L = 40;
    const totalVolume = W * H * L; // 1920 blocks

    const seenIndices = new Set<number>();

    // Test injectivity & range: every (x,y,z) maps to a distinct index in [0, V-1]
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < L; z++) {
        for (let x = 0; x < W; x++) {
          const idx = encodeCoord(x, y, z, W, L);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(totalVolume);
          expect(seenIndices.has(idx)).toBe(false);
          seenIndices.add(idx);

          // Test invertibility: decode(encode(pos)) === pos
          const decoded = decodeIndex(idx, W, L);
          expect(decoded.x).toBe(x);
          expect(decoded.y).toBe(y);
          expect(decoded.z).toBe(z);
        }
      }
    }

    // Test surjectivity: exactly totalVolume distinct indices covered
    expect(seenIndices.size).toBe(totalVolume);
  });

  it('should prove bijectivity across edge-case dimensions (1x1x1, 1x3x1, 17x7x23)', () => {
    const testCases = [
      { W: 1, H: 1, L: 1 },
      { W: 1, H: 3, L: 1 },
      { W: 17, H: 7, L: 23 },
    ];

    for (const { W, H, L } of testCases) {
      const volume = W * H * L;
      const seen = new Set<number>();

      for (let y = 0; y < H; y++) {
        for (let z = 0; z < L; z++) {
          for (let x = 0; x < W; x++) {
            const idx = encodeCoord(x, y, z, W, L);
            expect(seen.has(idx)).toBe(false);
            seen.add(idx);
            const decoded = decodeIndex(idx, W, L);
            expect(decoded).toEqual({ x, y, z });
          }
        }
      }

      expect(seen.size).toBe(volume);
    }
  });

  it('should demonstrate that out-of-bounds coordinates cause collisions without validation', () => {
    const W = 16;
    const L = 40;

    // x = 16, y = 0, z = 0 encodes to: (0 * 40 + 0) * 16 + 16 = 16
    // x = 0, y = 0, z = 1 encodes to: (0 * 40 + 1) * 16 + 0 = 16
    const collision1 = encodeCoord(16, 0, 0, W, L);
    const collision2 = encodeCoord(0, 0, 1, W, L);
    expect(collision1).toBe(collision2);

    // This adversarial check proves that input coordinates MUST strictly satisfy:
    // 0 <= x < width, 0 <= y < height, 0 <= z < length
    // to prevent coordinate wrapping bugs in downstream schematic generators.
  });
});

describe('Milestone 1 Adversarial Challenge: Redstone Repeater Delay Combinations', () => {
  function calculateRepeaterChain(deltaTicks: number): number[] {
    if (deltaTicks <= 0) return [];
    const chain: number[] = [];
    let rem = deltaTicks;
    while (rem >= 4) {
      chain.push(4);
      rem -= 4;
    }
    if (rem > 0) chain.push(rem);
    return chain;
  }

  it('should optimally allocate repeater delays for all deltaTicks from 1 to 20', () => {
    for (let dt = 1; dt <= 20; dt++) {
      const chain = calculateRepeaterChain(dt);

      // Invariant 1: Total delay matches deltaTicks exactly
      const totalDelay = chain.reduce((acc, v) => acc + v, 0);
      expect(totalDelay).toBe(dt);

      // Invariant 2: Each repeater setting is strictly in {1, 2, 3, 4}
      for (const delay of chain) {
        expect(delay).toBeGreaterThanOrEqual(1);
        expect(delay).toBeLessThanOrEqual(4);
      }

      // Invariant 3: Minimal repeater block count = ceil(dt / 4)
      const expectedBlockCount = Math.ceil(dt / 4);
      expect(chain.length).toBe(expectedBlockCount);

      // Invariant 4: Maximum one non-4 repeater (the remainder)
      const nonFours = chain.filter((d) => d < 4);
      expect(nonFours.length).toBeLessThanOrEqual(1);
      if (dt % 4 !== 0) {
        expect(nonFours.length).toBe(1);
        expect(nonFours[0]).toBe(dt % 4);
      } else {
        expect(nonFours.length).toBe(0);
      }
    }
  });

  it('should handle edge cases: dt=0 (polyphony/chords), dt<0 (invalid), dt=1000 (long pause)', () => {
    expect(calculateRepeaterChain(0)).toEqual([]);
    expect(calculateRepeaterChain(-1)).toEqual([]);
    expect(calculateRepeaterChain(-50)).toEqual([]);

    const longChain = calculateRepeaterChain(1000);
    expect(longChain.length).toBe(250);
    expect(longChain.every((d) => d === 4)).toBe(true);
    expect(longChain.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe('Milestone 1 Adversarial Challenge: Redstone Quantization Jitter & Precision', () => {
  function quantizeToRedstoneTick(seconds: number): number {
    return Math.round(seconds * REDSTONE_TICKS_PER_SECOND);
  }

  it('should correctly quantize floating-point time boundaries with IEEE 754 precision', () => {
    // 0.049999999 -> 0
    expect(quantizeToRedstoneTick(0.049999)).toBe(0);
    // 0.05 -> 1
    expect(quantizeToRedstoneTick(0.05)).toBe(1);
    // 0.149999 -> 1
    expect(quantizeToRedstoneTick(0.149999)).toBe(1);
    // 0.15 -> 2
    expect(quantizeToRedstoneTick(0.15)).toBe(2);
    // Negative boundary: -0.04 -> 0 (or -0)
    expect(Math.abs(quantizeToRedstoneTick(-0.04))).toBe(0);
  });

  it('should analyze quantization jitter across musical tempos', () => {
    const testBpms = [60, 100, 120, 128, 140, 160];

    for (const bpm of testBpms) {
      const beatSec = 60 / bpm;
      const numBeats = 16;
      let maxJitterSec = 0;

      for (let b = 1; b <= numBeats; b++) {
        const exactTime = b * beatSec;
        const tick = quantizeToRedstoneTick(exactTime);
        const quantizedTime = tick * REDSTONE_TICK_SECONDS;
        const jitter = Math.abs(quantizedTime - exactTime);
        if (jitter > maxJitterSec) maxJitterSec = jitter;
      }

      // Max possible quantization error for 10 Hz clock is 0.05s (half a tick)
      expect(maxJitterSec).toBeLessThanOrEqual(0.05 + 1e-9);

      // Quantization jitter must be exactly 0 for grid-aligned tempos (60 BPM, 120 BPM)
      if (bpm === 60 || bpm === 120) {
        expect(maxJitterSec).toBeCloseTo(0, 9);
      }
    }
  });
});

describe('Milestone 1 Adversarial Challenge: Web Audio Pitch Multiplier Monotonicity & Precision', () => {
  it('should verify exact exponential scaling 2^((note - 12)/12) across all 25 notes', () => {
    const semitoneRatio = Math.pow(2, 1 / 12);

    for (let note = 0; note <= 24; note++) {
      const mult = calculateNoteBlockPitchMultiplier(note);

      // Range bounds [0.5, 2.0]
      expect(mult).toBeGreaterThanOrEqual(0.5);
      expect(mult).toBeLessThanOrEqual(2.0);

      // Note 12 must be exact 1.0
      if (note === 12) {
        expect(mult).toBe(1.0);
      }

      // Monotonic step ratio check
      if (note < 24) {
        const nextMult = calculateNoteBlockPitchMultiplier(note + 1);
        const ratio = nextMult / mult;
        expect(ratio).toBeCloseTo(semitoneRatio, 10);
      }
    }
  });

  it('should reject invalid pitch inputs via isValidNoteBlockPitch', () => {
    const invalidPitches = [-100, -1, 25, 26, 100, 12.5, 0.5, NaN, Infinity, -Infinity];
    for (const p of invalidPitches) {
      expect(isValidNoteBlockPitch(p)).toBe(false);
    }

    for (let p = 0; p <= 24; p++) {
      expect(isValidNoteBlockPitch(p)).toBe(true);
    }
  });
});
