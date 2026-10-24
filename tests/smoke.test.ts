import { describe, it, expect } from 'vitest';
import {
  REDSTONE_TICK_SECONDS,
  REDSTONE_TICKS_PER_SECOND,
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  NOTEBLOCK_PITCH_COUNT,
  BASE_NOTE_PITCH_MIDI,
  CENTER_NOTE_PITCH_MIDI,
  MAX_NOTE_PITCH_MIDI,
  DEFAULT_MICROSECONDS_PER_QUARTER,
  DEFAULT_TICKS_PER_QUARTER,
  MINECRAFT_INSTRUMENTS,
  INSTRUMENT_METADATA,
  calculateNoteBlockPitchMultiplier,
  isMinecraftInstrument,
  isValidNoteBlockPitch,
  NbtTagType,
  type MinecraftInstrument,
  type NoteBlockEvent,
  type SongTimeline,
  type MidiFile,
  type SchematicExportOptions,
  type SchematicResult,
} from '../src/core/types';

describe('Milestone 1 Smoke Test: Project Setup & System Constants', () => {
  it('should define accurate redstone timing constants (10 Hz clock)', () => {
    expect(REDSTONE_TICK_SECONDS).toBe(0.1);
    expect(REDSTONE_TICKS_PER_SECOND).toBe(10);
    expect(1 / REDSTONE_TICKS_PER_SECOND).toBeCloseTo(REDSTONE_TICK_SECONDS, 6);
  });

  it('should define strict note block pitch bounds (0 to 24 semitones)', () => {
    expect(MIN_NOTEBLOCK_PITCH).toBe(0);
    expect(MAX_NOTEBLOCK_PITCH).toBe(24);
    expect(NOTEBLOCK_PITCH_COUNT).toBe(25);
    expect(MAX_NOTEBLOCK_PITCH - MIN_NOTEBLOCK_PITCH + 1).toBe(NOTEBLOCK_PITCH_COUNT);
  });

  it('should define correct MIDI pitch reference points (F#3 to F#5)', () => {
    expect(BASE_NOTE_PITCH_MIDI).toBe(54); // F#3
    expect(CENTER_NOTE_PITCH_MIDI).toBe(66); // F#4
    expect(MAX_NOTE_PITCH_MIDI).toBe(78); // F#5
    expect(MAX_NOTE_PITCH_MIDI - BASE_NOTE_PITCH_MIDI).toBe(24);
    expect(CENTER_NOTE_PITCH_MIDI - BASE_NOTE_PITCH_MIDI).toBe(12);
  });

  it('should define default tempo constants matching General MIDI standards (120 BPM, 480 PPQ)', () => {
    expect(DEFAULT_MICROSECONDS_PER_QUARTER).toBe(500_000);
    expect(DEFAULT_TICKS_PER_QUARTER).toBe(480);
    const calculatedBpm = 60_000_000 / DEFAULT_MICROSECONDS_PER_QUARTER;
    expect(calculatedBpm).toBe(120);
  });

  it('should define exactly 16 distinct vanilla Minecraft instruments', () => {
    expect(MINECRAFT_INSTRUMENTS).toHaveLength(16);
    const uniqueInstruments = new Set(MINECRAFT_INSTRUMENTS);
    expect(uniqueInstruments.size).toBe(16);

    const expectedInstruments: MinecraftInstrument[] = [
      'harp',
      'basedrum',
      'snare',
      'hat',
      'bass',
      'flute',
      'bell',
      'guitar',
      'chime',
      'xylophone',
      'iron_xylophone',
      'cow_bell',
      'didgeridoo',
      'bit',
      'banjo',
      'pling',
    ];

    for (const inst of expectedInstruments) {
      expect(MINECRAFT_INSTRUMENTS).toContain(inst);
    }
  });

  it('should maintain comprehensive metadata for all 16 instruments', () => {
    for (const inst of MINECRAFT_INSTRUMENTS) {
      const meta = INSTRUMENT_METADATA[inst];
      expect(meta).toBeDefined();
      expect(meta.name).toBe(inst);
      expect(typeof meta.displayName).toBe('string');
      expect(meta.displayName.length).toBeGreaterThan(0);
      expect(meta.baseBlock).toMatch(/^minecraft:[a-z0-9_]+$/);
      expect(meta.soundEvent).toMatch(/^minecraft:block\.note_block\.[a-z0-9_]+$/);
      expect(Math.abs(meta.octaveOffset) % 12).toBe(0);
      expect(meta.minMidiPitch).toBe(BASE_NOTE_PITCH_MIDI + meta.octaveOffset);
      expect(meta.maxMidiPitch).toBe(MAX_NOTE_PITCH_MIDI + meta.octaveOffset);
    }

    // Verify critical base block substrate assignments
    expect(INSTRUMENT_METADATA.harp.baseBlock).toBe('minecraft:dirt');
    expect(INSTRUMENT_METADATA.basedrum.baseBlock).toBe('minecraft:stone');
    expect(INSTRUMENT_METADATA.snare.baseBlock).toBe('minecraft:sand');
    expect(INSTRUMENT_METADATA.hat.baseBlock).toBe('minecraft:glass');
    expect(INSTRUMENT_METADATA.bass.baseBlock).toBe('minecraft:oak_planks');
    expect(INSTRUMENT_METADATA.bell.baseBlock).toBe('minecraft:gold_block');
    expect(INSTRUMENT_METADATA.flute.baseBlock).toBe('minecraft:clay');
    expect(INSTRUMENT_METADATA.chime.baseBlock).toBe('minecraft:packed_ice');
    expect(INSTRUMENT_METADATA.iron_xylophone.baseBlock).toBe('minecraft:iron_block');
    expect(INSTRUMENT_METADATA.cow_bell.baseBlock).toBe('minecraft:soul_sand');
    expect(INSTRUMENT_METADATA.didgeridoo.baseBlock).toBe('minecraft:pumpkin');
    expect(INSTRUMENT_METADATA.bit.baseBlock).toBe('minecraft:emerald_block');
    expect(INSTRUMENT_METADATA.banjo.baseBlock).toBe('minecraft:hay_block');
    expect(INSTRUMENT_METADATA.pling.baseBlock).toBe('minecraft:glowstone');
  });
});

describe('Milestone 1 Smoke Test: Mathematical Formulas & Algorithmic Invariants', () => {
  it('should compute exact Minecraft Web Audio playback rate multipliers: 2^((note - 12) / 12)', () => {
    // Note 0 (F#3) -> 0.5 (one octave down)
    expect(calculateNoteBlockPitchMultiplier(0)).toBe(0.5);
    // Note 12 (F#4) -> 1.0 (nominal base pitch)
    expect(calculateNoteBlockPitchMultiplier(12)).toBe(1.0);
    // Note 24 (F#5) -> 2.0 (one octave up)
    expect(calculateNoteBlockPitchMultiplier(24)).toBe(2.0);
    // Note 6 (C4) -> sqrt(0.5) ~ 0.7071
    expect(calculateNoteBlockPitchMultiplier(6)).toBeCloseTo(Math.SQRT1_2, 6);

    // Verify strict monotonicity across 0-24
    for (let n = 0; n < 24; n++) {
      expect(calculateNoteBlockPitchMultiplier(n)).toBeLessThan(calculateNoteBlockPitchMultiplier(n + 1));
    }

    // Verify constant semitone frequency ratio (2^(1/12) ~ 1.059463)
    const expectedRatio = Math.pow(2, 1 / 12);
    for (let n = 0; n < 24; n++) {
      const ratio = calculateNoteBlockPitchMultiplier(n + 1) / calculateNoteBlockPitchMultiplier(n);
      expect(ratio).toBeCloseTo(expectedRatio, 6);
    }
  });

  it('should satisfy octave folding pitch mapping invariants across all 128 MIDI notes', () => {
    // Canonical pitch folding function
    function foldMidiPitch(pitch: number): number {
      let p = pitch;
      while (p < 54) p += 12;
      while (p > 78) p -= 12;
      return p - 54;
    }

    for (let midi = 0; midi < 128; midi++) {
      const folded = foldMidiPitch(midi);
      // Invariant 1: Bound containment strictly in [0, 24]
      expect(folded).toBeGreaterThanOrEqual(0);
      expect(folded).toBeLessThanOrEqual(24);
      // Invariant 2: Harmony pitch class preservation (modulo 12)
      expect((folded + 54) % 12).toBe(midi % 12);
    }

    // Invariant 3: In-range notes [54, 78] map directly to pitch - 54
    for (let midi = 54; midi <= 78; midi++) {
      expect(foldMidiPitch(midi)).toBe(midi - 54);
    }
  });

  it('should satisfy redstone tick time quantization formula (10 Hz rounding)', () => {
    function quantizeToTick(seconds: number): number {
      return Math.round(seconds * 10);
    }

    expect(quantizeToTick(0.0)).toBe(0);
    expect(quantizeToTick(0.04)).toBe(0);
    expect(quantizeToTick(0.0499)).toBe(0);
    expect(quantizeToTick(0.05)).toBe(1); // Boundary round-up
    expect(quantizeToTick(0.09)).toBe(1);
    expect(quantizeToTick(0.10)).toBe(1);
    expect(quantizeToTick(0.14)).toBe(1);
    expect(quantizeToTick(0.15)).toBe(2);
    expect(quantizeToTick(0.50)).toBe(5);
    expect(quantizeToTick(1.00)).toBe(10);
    expect(quantizeToTick(1.25)).toBe(13);
  });

  it('should satisfy greedy redstone repeater delay allocation algorithm', () => {
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

    expect(calculateRepeaterChain(0)).toEqual([]);
    expect(calculateRepeaterChain(1)).toEqual([1]);
    expect(calculateRepeaterChain(2)).toEqual([2]);
    expect(calculateRepeaterChain(3)).toEqual([3]);
    expect(calculateRepeaterChain(4)).toEqual([4]);
    expect(calculateRepeaterChain(5)).toEqual([4, 1]);
    expect(calculateRepeaterChain(7)).toEqual([4, 3]);
    expect(calculateRepeaterChain(8)).toEqual([4, 4]);
    expect(calculateRepeaterChain(10)).toEqual([4, 4, 2]);

    // Test invariant across random tick values
    for (let dt = 1; dt <= 50; dt++) {
      const chain = calculateRepeaterChain(dt);
      const sum = chain.reduce((acc, val) => acc + val, 0);
      expect(sum).toBe(dt);
      for (const d of chain) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(4);
      }
      const underFour = chain.filter((d) => d < 4);
      expect(underFour.length).toBeLessThanOrEqual(1);
    }
  });

  it('should satisfy bijective 3D Sponge schematic coordinate indexing formula', () => {
    function encodeIndex(x: number, y: number, z: number, width: number, length: number): number {
      return (y * length + z) * width + x;
    }

    function decodeIndex(index: number, width: number, length: number): { x: number; y: number; z: number } {
      const x = index % width;
      const rem = Math.floor(index / width);
      const z = rem % length;
      const y = Math.floor(rem / length);
      return { x, y, z };
    }

    const W = 16;
    const H = 3;
    const L = 30;
    const totalVolume = W * H * L;

    // Corner cases
    expect(encodeIndex(0, 0, 0, W, L)).toBe(0);
    expect(encodeIndex(W - 1, H - 1, L - 1, W, L)).toBe(totalVolume - 1);

    // Test invertibility across grid sample
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < L; z += 5) {
        for (let x = 0; x < W; x += 4) {
          const idx = encodeIndex(x, y, z, W, L);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(totalVolume);
          const decoded = decodeIndex(idx, W, L);
          expect(decoded).toEqual({ x, y, z });
        }
      }
    }
  });
});

describe('Milestone 1 Smoke Test: Type Guards & Validation Helpers', () => {
  it('should validate MinecraftInstrument values correctly via isMinecraftInstrument', () => {
    expect(isMinecraftInstrument('harp')).toBe(true);
    expect(isMinecraftInstrument('bass')).toBe(true);
    expect(isMinecraftInstrument('pling')).toBe(true);
    expect(isMinecraftInstrument('bit')).toBe(true);

    expect(isMinecraftInstrument('piano')).toBe(false);
    expect(isMinecraftInstrument('violin')).toBe(false);
    expect(isMinecraftInstrument('')).toBe(false);
    expect(isMinecraftInstrument(null)).toBe(false);
    expect(isMinecraftInstrument(undefined)).toBe(false);
    expect(isMinecraftInstrument(123)).toBe(false);
    expect(isMinecraftInstrument({})).toBe(false);
  });

  it('should validate pitch integers via isValidNoteBlockPitch', () => {
    expect(isValidNoteBlockPitch(0)).toBe(true);
    expect(isValidNoteBlockPitch(12)).toBe(true);
    expect(isValidNoteBlockPitch(24)).toBe(true);

    expect(isValidNoteBlockPitch(-1)).toBe(false);
    expect(isValidNoteBlockPitch(25)).toBe(false);
    expect(isValidNoteBlockPitch(12.5)).toBe(false);
    expect(isValidNoteBlockPitch(NaN)).toBe(false);
    expect(isValidNoteBlockPitch(Infinity)).toBe(false);
  });
});

describe('Milestone 1 Smoke Test: Core Interface Conformance (Mock Objects)', () => {
  it('should construct a valid NoteBlockEvent mock object', () => {
    const event: NoteBlockEvent = {
      redstoneTick: 10,
      timestampSeconds: 1.0,
      instrument: 'harp',
      baseBlock: 'minecraft:dirt',
      note: 12,
      velocity: 0.8,
      trackId: 0,
      channel: 0,
    };

    expect(event.redstoneTick).toBe(10);
    expect(event.note).toBe(12);
    expect(event.instrument).toBe('harp');
  });

  it('should construct a valid SongTimeline mock object', () => {
    const event: NoteBlockEvent = {
      redstoneTick: 0,
      timestampSeconds: 0.0,
      instrument: 'pling',
      baseBlock: 'minecraft:glowstone',
      note: 14,
      velocity: 1.0,
      trackId: 1,
    };

    const timeline: SongTimeline = {
      title: 'Smoke Test Melody',
      totalRedstoneTicks: 50,
      durationSeconds: 5.0,
      bpm: 120,
      eventsByTick: new Map([[0, [event]]]),
      allEvents: [event],
      tracks: [
        {
          id: 1,
          name: 'Lead Track',
          instrument: 'pling',
          noteCount: 1,
          isPercussion: false,
        },
      ],
    };

    expect(timeline.totalRedstoneTicks).toBe(50);
    expect(timeline.eventsByTick.get(0)).toHaveLength(1);
    expect(timeline.tracks[0]?.instrument).toBe('pling');
  });

  it('should construct a valid MidiFile mock object', () => {
    const midi: MidiFile = {
      format: 1,
      numTracks: 1,
      ticksPerQuarterNote: 480,
      tracks: [
        {
          id: 0,
          name: 'Track 1',
          channel: 0,
          instrumentProgram: 0,
          isPercussion: false,
          notes: [
            {
              pitch: 60,
              velocity: 100,
              startTick: 0,
              durationTicks: 480,
              startSeconds: 0.0,
              durationSeconds: 0.5,
              channel: 0,
              program: 0,
            },
          ],
          totalTicks: 480,
        },
      ],
      tempoMap: [
        {
          tick: 0,
          microsecondsPerQuarter: 500_000,
          bpm: 120,
          seconds: 0.0,
        },
      ],
      timeSignatures: [
        {
          tick: 0,
          numerator: 4,
          denominator: 4,
          clocksPerClick: 24,
          thirtySecondsPerQuarter: 8,
        },
      ],
      keySignatures: [
        {
          tick: 0,
          key: 0,
          scale: 0,
        },
      ],
      durationSeconds: 0.5,
      totalTicks: 480,
    };

    expect(midi.format).toBe(1);
    expect(midi.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('should construct valid SchematicExportOptions and SchematicResult objects', () => {
    const options: SchematicExportOptions = {
      name: 'TestSchematic',
      author: 'MidiToNoteBlock',
      maxTrackWidth: 16,
      maxTrackLength: 40,
      supportGravityBlocks: true,
      spongeVersion: 2,
    };

    const result: SchematicResult = {
      filename: 'test.schem',
      mimeType: 'application/x-minecraft-schematic',
      data: new Uint8Array([0x1f, 0x8b]), // Gzip header magic bytes
      dimensions: { width: 16, height: 3, length: 40 },
      totalNoteBlocks: 25,
      totalRepeaters: 30,
    };

    expect(options.spongeVersion).toBe(2);
    expect(result.data.length).toBe(2);
    expect(result.dimensions.height).toBe(3);
  });

  it('should adhere to standard Mojang NBT tag ID enumerations (0 to 12)', () => {
    expect(NbtTagType.TAG_End).toBe(0);
    expect(NbtTagType.TAG_Byte).toBe(1);
    expect(NbtTagType.TAG_Short).toBe(2);
    expect(NbtTagType.TAG_Int).toBe(3);
    expect(NbtTagType.TAG_Long).toBe(4);
    expect(NbtTagType.TAG_Float).toBe(5);
    expect(NbtTagType.TAG_Double).toBe(6);
    expect(NbtTagType.TAG_Byte_Array).toBe(7);
    expect(NbtTagType.TAG_String).toBe(8);
    expect(NbtTagType.TAG_List).toBe(9);
    expect(NbtTagType.TAG_Compound).toBe(10);
    expect(NbtTagType.TAG_Int_Array).toBe(11);
    expect(NbtTagType.TAG_Long_Array).toBe(12);
  });
});
