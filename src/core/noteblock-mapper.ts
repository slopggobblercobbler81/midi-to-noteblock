/**
 * src/core/noteblock-mapper.ts
 *
 * Milestone 3: Note Block Mapping & Quantizer Engine.
 *
 * Implements:
 * 1. Strict pitch clamping & smart octave folding into Minecraft [0, 24] range (F#3 to F#5).
 * 2. 128 General MIDI instrument mapping to 16 Minecraft instruments & base blocks.
 * 3. Channel 9 percussion mapping to unpitched note block instruments with tuned semitone pitches.
 * 4. Multi-octave natural register compensation (6-octave acoustic range, MIDI 30 to 102).
 * 5. Global optimal key transposition (minimizing out-of-bounds notes with key-lock support).
 * 6. 10 Hz redstone tick quantization (0.1s increments) with zero cumulative drift.
 * 7. Greedy repeater delay decomposition (1 to 4 tick repeaters).
 * 8. Complete SongTimeline construction with polyphonic event grouping.
 *
 * Pure client-side with zero external runtime dependencies.
 */

import {
  type MidiFile,
  type MinecraftInstrument,
  type NoteBlockEvent,
  type TrackSummary,
  type SongTimeline,
  type ConversionOptions,
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  BASE_NOTE_PITCH_MIDI,
  MAX_NOTE_PITCH_MIDI,
  REDSTONE_TICK_SECONDS,
  REDSTONE_TICKS_PER_SECOND,
  INSTRUMENT_METADATA,
  isMinecraftInstrument,
} from './types';

// ============================================================================
// 1. DATA STRUCTURES & INTERFACES
// ============================================================================

export interface GmInstrumentMapping {
  readonly program: number;
  readonly name: string;
  readonly instrument: MinecraftInstrument;
  readonly baseBlock: string;
  readonly octaveOffset: number;
}

export interface GmPercussionMapping {
  readonly pitch: number;
  readonly name: string;
  readonly instrument: MinecraftInstrument;
  readonly baseBlock: string;
  readonly note: number;
}

export interface FoldResult {
  readonly note: number;
  readonly foldedPitch: number;
  readonly octaveShift: number;
}

// Backward-compatible type alias
export type GMInstrumentMapping = GmInstrumentMapping;
export type DrumNoteMapping = GmPercussionMapping;

// ============================================================================
// 2. COMPLETE 128 GENERAL MIDI INSTRUMENT MAPPING TABLE (0-127)
// ============================================================================

export const GM_INSTRUMENT_MAP: readonly GmInstrumentMapping[] = Object.freeze([
  // --- 0-7: Piano ---
  { program: 0, name: 'Acoustic Grand Piano', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 1, name: 'Bright Acoustic Piano', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 2, name: 'Electric Grand Piano', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 3, name: 'Honky-tonk Piano', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 4, name: 'Electric Piano 1 (Rhodes)', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 5, name: 'Electric Piano 2 (Chorused)', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 6, name: 'Harpsichord', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 7, name: 'Clavinet', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },

  // --- 8-15: Chromatic Percussion ---
  { program: 8, name: 'Celesta', instrument: 'chime', baseBlock: 'minecraft:packed_ice', octaveOffset: 24 },
  { program: 9, name: 'Glockenspiel', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 10, name: 'Music Box', instrument: 'iron_xylophone', baseBlock: 'minecraft:iron_block', octaveOffset: 0 },
  { program: 11, name: 'Vibraphone', instrument: 'iron_xylophone', baseBlock: 'minecraft:iron_block', octaveOffset: 0 },
  { program: 12, name: 'Marimba', instrument: 'xylophone', baseBlock: 'minecraft:bone_block', octaveOffset: 24 },
  { program: 13, name: 'Xylophone', instrument: 'xylophone', baseBlock: 'minecraft:bone_block', octaveOffset: 24 },
  { program: 14, name: 'Tubular Bells', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 15, name: 'Dulcimer', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },

  // --- 16-23: Organ ---
  { program: 16, name: 'Drawbar Organ', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 17, name: 'Percussive Organ', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 18, name: 'Rock Organ', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 19, name: 'Church Organ', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 20, name: 'Reed Organ', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 21, name: 'Accordion', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 22, name: 'Harmonica', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 23, name: 'Tango Accordion', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },

  // --- 24-31: Guitar ---
  { program: 24, name: 'Acoustic Guitar (nylon)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 25, name: 'Acoustic Guitar (steel)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 26, name: 'Electric Guitar (jazz)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 27, name: 'Electric Guitar (clean)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 28, name: 'Electric Guitar (muted)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 29, name: 'Overdriven Guitar', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 30, name: 'Distortion Guitar', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 31, name: 'Guitar Harmonics', instrument: 'chime', baseBlock: 'minecraft:packed_ice', octaveOffset: 24 },

  // --- 32-39: Bass ---
  { program: 32, name: 'Acoustic Bass', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 33, name: 'Electric Bass (finger)', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 34, name: 'Electric Bass (pick)', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 35, name: 'Fretless Bass', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 36, name: 'Slap Bass 1', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 37, name: 'Slap Bass 2', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 38, name: 'Synth Bass 1', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 39, name: 'Synth Bass 2', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },

  // --- 40-47: Strings ---
  { program: 40, name: 'Violin', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 41, name: 'Viola', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 42, name: 'Cello', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 43, name: 'Contrabass', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },
  { program: 44, name: 'Tremolo Strings', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 45, name: 'Pizzicato Strings', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 46, name: 'Orchestral Harp', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 47, name: 'Timpani', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },

  // --- 48-55: Ensemble ---
  { program: 48, name: 'String Ensemble 1', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 49, name: 'String Ensemble 2', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 50, name: 'Synth Strings 1', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 51, name: 'Synth Strings 2', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 52, name: 'Choir Aahs', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 53, name: 'Voice Oohs', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 54, name: 'Synth Voice', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 55, name: 'Orchestra Hit', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },

  // --- 56-63: Brass ---
  { program: 56, name: 'Trumpet', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 57, name: 'Trombone', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 58, name: 'Tuba', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 59, name: 'Muted Trumpet', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 60, name: 'French Horn', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 61, name: 'Brass Section', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 62, name: 'Synth Brass 1', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 63, name: 'Synth Brass 2', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },

  // --- 64-71: Reed ---
  { program: 64, name: 'Soprano Sax', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 65, name: 'Alto Sax', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 66, name: 'Tenor Sax', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 67, name: 'Baritone Sax', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 68, name: 'Oboe', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 69, name: 'English Horn', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 70, name: 'Bassoon', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 71, name: 'Clarinet', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },

  // --- 72-79: Pipe ---
  { program: 72, name: 'Piccolo', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 73, name: 'Flute', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 74, name: 'Recorder', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 75, name: 'Pan Flute', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 76, name: 'Blown Bottle', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 77, name: 'Shakuhachi', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 78, name: 'Whistle', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 79, name: 'Ocarina', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },

  // --- 80-87: Synth Lead ---
  { program: 80, name: 'Lead 1 (square)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 81, name: 'Lead 2 (sawtooth)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 82, name: 'Lead 3 (calliope)', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 83, name: 'Lead 4 (chiff)', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 84, name: 'Lead 5 (charang)', instrument: 'guitar', baseBlock: 'minecraft:white_wool', octaveOffset: -12 },
  { program: 85, name: 'Lead 6 (voice)', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 86, name: 'Lead 7 (fifths)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 87, name: 'Lead 8 (bass + lead)', instrument: 'bass', baseBlock: 'minecraft:oak_planks', octaveOffset: -24 },

  // --- 88-95: Synth Pad ---
  { program: 88, name: 'Pad 1 (new age)', instrument: 'chime', baseBlock: 'minecraft:packed_ice', octaveOffset: 24 },
  { program: 89, name: 'Pad 2 (warm)', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 90, name: 'Pad 3 (polysynth)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 91, name: 'Pad 4 (choir)', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 92, name: 'Pad 5 (bowed)', instrument: 'harp', baseBlock: 'minecraft:dirt', octaveOffset: 0 },
  { program: 93, name: 'Pad 6 (metallic)', instrument: 'iron_xylophone', baseBlock: 'minecraft:iron_block', octaveOffset: 0 },
  { program: 94, name: 'Pad 7 (halo)', instrument: 'chime', baseBlock: 'minecraft:packed_ice', octaveOffset: 24 },
  { program: 95, name: 'Pad 8 (sweep)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },

  // --- 96-103: Synth Effects ---
  { program: 96, name: 'FX 1 (rain)', instrument: 'chime', baseBlock: 'minecraft:packed_ice', octaveOffset: 24 },
  { program: 97, name: 'FX 2 (soundtrack)', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 98, name: 'FX 3 (crystal)', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 99, name: 'FX 4 (atmosphere)', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 100, name: 'FX 5 (brightness)', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 101, name: 'FX 6 (goblins)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },
  { program: 102, name: 'FX 7 (echoes)', instrument: 'pling', baseBlock: 'minecraft:glowstone', octaveOffset: 0 },
  { program: 103, name: 'FX 8 (sci-fi)', instrument: 'bit', baseBlock: 'minecraft:emerald_block', octaveOffset: 0 },

  // --- 104-111: Ethnic ---
  { program: 104, name: 'Sitar', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 105, name: 'Banjo', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 106, name: 'Shamisen', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 107, name: 'Koto', instrument: 'banjo', baseBlock: 'minecraft:hay_block', octaveOffset: 0 },
  { program: 108, name: 'Kalimba', instrument: 'iron_xylophone', baseBlock: 'minecraft:iron_block', octaveOffset: 0 },
  { program: 109, name: 'Bagpipe', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', octaveOffset: -24 },
  { program: 110, name: 'Fiddle', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },
  { program: 111, name: 'Shanai', instrument: 'flute', baseBlock: 'minecraft:clay', octaveOffset: 12 },

  // --- 112-119: Percussive Melodic ---
  { program: 112, name: 'Tinkle Bell', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 113, name: 'Agogo', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', octaveOffset: 12 },
  { program: 114, name: 'Steel Drums', instrument: 'iron_xylophone', baseBlock: 'minecraft:iron_block', octaveOffset: 0 },
  { program: 115, name: 'Woodblock', instrument: 'hat', baseBlock: 'minecraft:glass', octaveOffset: 0 },
  { program: 116, name: 'Taiko Drum', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },
  { program: 117, name: 'Melodic Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },
  { program: 118, name: 'Synth Drum', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },
  { program: 119, name: 'Reverse Cymbal', instrument: 'snare', baseBlock: 'minecraft:sand', octaveOffset: 0 },

  // --- 120-127: Sound Effects ---
  { program: 120, name: 'Guitar Fret Noise', instrument: 'hat', baseBlock: 'minecraft:glass', octaveOffset: 0 },
  { program: 121, name: 'Breath Noise', instrument: 'snare', baseBlock: 'minecraft:sand', octaveOffset: 0 },
  { program: 122, name: 'Seashore', instrument: 'snare', baseBlock: 'minecraft:sand', octaveOffset: 0 },
  { program: 123, name: 'Bird Tweet', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 124, name: 'Telephone Ring', instrument: 'bell', baseBlock: 'minecraft:gold_block', octaveOffset: 24 },
  { program: 125, name: 'Helicopter', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },
  { program: 126, name: 'Applause', instrument: 'snare', baseBlock: 'minecraft:sand', octaveOffset: 0 },
  { program: 127, name: 'Gunshot', instrument: 'basedrum', baseBlock: 'minecraft:stone', octaveOffset: 0 },
]);

// ============================================================================
// 3. COMPLETE CHANNEL 9/10 PERCUSSION KEY MAP (NOTES 35-81)
// ============================================================================

export const GM_PERCUSSION_MAP: Readonly<Record<number, GmPercussionMapping>> = Object.freeze({
  35: { pitch: 35, name: 'Acoustic Bass Drum', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 1 },
  36: { pitch: 36, name: 'Bass Drum 1', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 3 },
  37: { pitch: 37, name: 'Side Stick', instrument: 'hat', baseBlock: 'minecraft:glass', note: 18 },
  38: { pitch: 38, name: 'Acoustic Snare', instrument: 'snare', baseBlock: 'minecraft:sand', note: 8 },
  39: { pitch: 39, name: 'Hand Clap', instrument: 'snare', baseBlock: 'minecraft:sand', note: 12 },
  40: { pitch: 40, name: 'Electric Snare', instrument: 'snare', baseBlock: 'minecraft:sand', note: 14 },
  41: { pitch: 41, name: 'Low Floor Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 6 },
  42: { pitch: 42, name: 'Closed Hi-Hat', instrument: 'hat', baseBlock: 'minecraft:glass', note: 22 },
  43: { pitch: 43, name: 'High Floor Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 8 },
  44: { pitch: 44, name: 'Pedal Hi-Hat', instrument: 'hat', baseBlock: 'minecraft:glass', note: 20 },
  45: { pitch: 45, name: 'Low Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 10 },
  46: { pitch: 46, name: 'Open Hi-Hat', instrument: 'snare', baseBlock: 'minecraft:sand', note: 18 },
  47: { pitch: 47, name: 'Low-Mid Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 12 },
  48: { pitch: 48, name: 'Hi-Mid Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 14 },
  49: { pitch: 49, name: 'Crash Cymbal 1', instrument: 'snare', baseBlock: 'minecraft:sand', note: 22 },
  50: { pitch: 50, name: 'High Tom', instrument: 'basedrum', baseBlock: 'minecraft:stone', note: 16 },
  51: { pitch: 51, name: 'Ride Cymbal 1', instrument: 'hat', baseBlock: 'minecraft:glass', note: 24 },
  52: { pitch: 52, name: 'Chinese Cymbal', instrument: 'snare', baseBlock: 'minecraft:sand', note: 20 },
  53: { pitch: 53, name: 'Ride Bell', instrument: 'bell', baseBlock: 'minecraft:gold_block', note: 18 },
  54: { pitch: 54, name: 'Tambourine', instrument: 'snare', baseBlock: 'minecraft:sand', note: 19 },
  55: { pitch: 55, name: 'Splash Cymbal', instrument: 'snare', baseBlock: 'minecraft:sand', note: 24 },
  56: { pitch: 56, name: 'Cowbell', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 12 },
  57: { pitch: 57, name: 'Crash Cymbal 2', instrument: 'snare', baseBlock: 'minecraft:sand', note: 21 },
  58: { pitch: 58, name: 'Vibraslap', instrument: 'snare', baseBlock: 'minecraft:sand', note: 16 },
  59: { pitch: 59, name: 'Ride Cymbal 2', instrument: 'hat', baseBlock: 'minecraft:glass', note: 23 },
  60: { pitch: 60, name: 'Hi Bongo', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 18 },
  61: { pitch: 61, name: 'Low Bongo', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 10 },
  62: { pitch: 62, name: 'Mute Hi Conga', instrument: 'hat', baseBlock: 'minecraft:glass', note: 14 },
  63: { pitch: 63, name: 'Open Hi Conga', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 14 },
  64: { pitch: 64, name: 'Low Conga', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 6 },
  65: { pitch: 65, name: 'High Timbale', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 20 },
  66: { pitch: 66, name: 'Low Timbale', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 14 },
  67: { pitch: 67, name: 'High Agogo', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 22 },
  68: { pitch: 68, name: 'Low Agogo', instrument: 'cow_bell', baseBlock: 'minecraft:soul_sand', note: 16 },
  69: { pitch: 69, name: 'Cabasa', instrument: 'hat', baseBlock: 'minecraft:glass', note: 16 },
  70: { pitch: 70, name: 'Maracas', instrument: 'hat', baseBlock: 'minecraft:glass', note: 19 },
  71: { pitch: 71, name: 'Short Whistle', instrument: 'flute', baseBlock: 'minecraft:clay', note: 22 },
  72: { pitch: 72, name: 'Long Whistle', instrument: 'flute', baseBlock: 'minecraft:clay', note: 18 },
  73: { pitch: 73, name: 'Short Guiro', instrument: 'hat', baseBlock: 'minecraft:glass', note: 12 },
  74: { pitch: 74, name: 'Long Guiro', instrument: 'snare', baseBlock: 'minecraft:sand', note: 10 },
  75: { pitch: 75, name: 'Claves', instrument: 'hat', baseBlock: 'minecraft:glass', note: 24 },
  76: { pitch: 76, name: 'Hi Wood Block', instrument: 'hat', baseBlock: 'minecraft:glass', note: 20 },
  77: { pitch: 77, name: 'Low Wood Block', instrument: 'hat', baseBlock: 'minecraft:glass', note: 14 },
  78: { pitch: 78, name: 'Mute Cuica', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', note: 16 },
  79: { pitch: 79, name: 'Open Cuica', instrument: 'didgeridoo', baseBlock: 'minecraft:pumpkin', note: 10 },
  80: { pitch: 80, name: 'Mute Triangle', instrument: 'hat', baseBlock: 'minecraft:glass', note: 24 },
  81: { pitch: 81, name: 'Open Triangle', instrument: 'chime', baseBlock: 'minecraft:packed_ice', note: 24 },
});

// Backward-compatible alias
export const DRUM_NOTE_MAP: Readonly<Record<number, GmPercussionMapping>> = GM_PERCUSSION_MAP;

// ============================================================================
// 4. LOOKUP & MAPPING HELPER FUNCTIONS
// ============================================================================

/**
 * Maps a General MIDI program number (0-127) or percussion flag to its corresponding
 * Minecraft Note Block instrument, substrate base block, and natural octave offset.
 */
export function mapMidiInstrument(
  program: number,
  isPercussion: boolean = false
): GmInstrumentMapping {
  if (isPercussion) {
    return {
      program: 0,
      name: 'Percussion Kit',
      instrument: 'basedrum',
      baseBlock: 'minecraft:stone',
      octaveOffset: 0,
    };
  }

  const safeProgram = Number.isFinite(program)
    ? Math.max(0, Math.min(127, Math.floor(program)))
    : 0;

  const mapping = GM_INSTRUMENT_MAP[safeProgram];
  if (mapping) {
    return mapping;
  }

  return GM_INSTRUMENT_MAP[0]!;
}

/**
 * Maps a MIDI drum key note (35-81) on Channel 9 to its tuned Minecraft percussion
 * instrument timbre, substrate block, and tuned semitone pitch (0 to 24).
 */
export function mapMidiPercussion(pitch: number): GmPercussionMapping {
  const safePitch = Math.floor(pitch);

  const exactMapping = GM_PERCUSSION_MAP[safePitch];
  if (exactMapping) {
    return exactMapping;
  }

  if (safePitch < 35) {
    return {
      pitch: safePitch,
      name: 'Sub Kick Drum',
      instrument: 'basedrum',
      baseBlock: 'minecraft:stone',
      note: 2,
    };
  }

  return {
    pitch: safePitch,
    name: 'High Percussion Click',
    instrument: 'hat',
    baseBlock: 'minecraft:glass',
    note: 20,
  };
}

/**
 * Retrieves the base block substrate required underneath a note block for a given instrument.
 */
export function getBaseBlock(instrument: MinecraftInstrument): string {
  const meta = INSTRUMENT_METADATA[instrument];
  return meta ? meta.baseBlock : 'minecraft:dirt';
}

/**
 * Retrieves the natural acoustic octave offset (-24 to +24 semitones) for an instrument.
 */
export function getNaturalOctaveOffset(instrument: MinecraftInstrument): number {
  const meta = INSTRUMENT_METADATA[instrument];
  return meta ? meta.octaveOffset : 0;
}

/**
 * Backward-compatible helper for legacy callers.
 */
export function mapMidiProgramToInstrument(
  program: number,
  isPercussion: boolean,
  midiPitch?: number
): MinecraftInstrument {
  if (isPercussion && midiPitch !== undefined) {
    return mapMidiPercussion(midiPitch).instrument;
  }
  return mapMidiInstrument(program, isPercussion).instrument;
}

// ============================================================================
// 5. TIMING & REPEATER UTILITIES
// ============================================================================

/**
 * Quantizes continuous seconds into discrete 10 Hz redstone ticks.
 * Formula: round(seconds * 10).
 */
export function quantizeToRedstoneTick(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * REDSTONE_TICKS_PER_SECOND);
}

/**
 * Decomposes an inter-note delay in redstone ticks into a chain of 1-4 tick repeaters.
 * Uses greedy 4-tick repeaters for maximum circuit compression.
 */
export function decomposeRepeaterDelay(deltaTicks: number): number[] {
  if (!Number.isFinite(deltaTicks) || deltaTicks <= 0) return [];
  const repeaters: number[] = [];
  let remaining = Math.floor(deltaTicks);
  while (remaining >= 4) {
    repeaters.push(4);
    remaining -= 4;
  }
  if (remaining > 0) {
    repeaters.push(remaining);
  }
  return repeaters;
}

// ============================================================================
// 6. PITCH FOLDING & TRANSPOSITION
// ============================================================================

/**
 * Detailed pitch folding calculation returning note, folded pitch, and octave shift.
 */
export function foldToRangeDetailed(
  pitch: number,
  octaveOffset: number = 0,
  enableOctaveFolding: boolean = true
): FoldResult {
  let effectivePitch = pitch - octaveOffset;
  let octaveShift = 0;

  if (enableOctaveFolding) {
    if (effectivePitch < BASE_NOTE_PITCH_MIDI) {
      const k = Math.ceil((BASE_NOTE_PITCH_MIDI - effectivePitch) / 12);
      effectivePitch += k * 12;
      octaveShift = k;
    } else if (effectivePitch > MAX_NOTE_PITCH_MIDI) {
      const k = Math.ceil((effectivePitch - MAX_NOTE_PITCH_MIDI) / 12);
      effectivePitch -= k * 12;
      octaveShift = -k;
    }
  } else {
    effectivePitch = Math.max(BASE_NOTE_PITCH_MIDI, Math.min(MAX_NOTE_PITCH_MIDI, effectivePitch));
  }

  const rawNote = effectivePitch - BASE_NOTE_PITCH_MIDI;
  const note = Math.max(MIN_NOTEBLOCK_PITCH, Math.min(MAX_NOTEBLOCK_PITCH, Math.round(rawNote)));

  return { note, foldedPitch: effectivePitch, octaveShift };
}

/**
 * Folds a pitch strictly into Minecraft's 0-24 semitone range.
 * Conforms to interface contract `foldToRange(midiPitch: number, octaveOffset?: number): number`.
 */
export function foldToRange(
  midiPitch: number,
  octaveOffset?: number
): number;
export function foldToRange(
  midiPitch: number,
  octaveOffset: number | undefined,
  detailed: true
): FoldResult;
export function foldToRange(
  midiPitch: number,
  octaveOffset: number = 0,
  detailed: boolean = false
): number | FoldResult {
  const result = foldToRangeDetailed(midiPitch, octaveOffset, true);
  return detailed ? result : result.note;
}

/**
 * Public pitch mapping function conforming to test-loader contract.
 */
export function mapMidiPitchToNoteBlock(
  pitch: number,
  instrument: string,
  options?: ConversionOptions
): { note: number; octaveShift: number } {
  const inst = isMinecraftInstrument(instrument) ? instrument : 'harp';
  const octaveOffset = getNaturalOctaveOffset(inst);
  const transpose = options?.manualTranspose ?? 0;
  const enableFolding = options?.enableOctaveFolding !== false;

  const result = foldToRangeDetailed(pitch + transpose, octaveOffset, enableFolding);
  return { note: result.note, octaveShift: result.octaveShift };
}

/**
 * Analyzes melodic notes and computes the song-wide transposition offset
 * that minimizes out-of-bounds octave folds.
 */
export function findOptimalTransposition(
  notes: Array<{ pitch: number; durationSeconds?: number; isPercussion?: boolean; octaveOffset?: number }>,
  options?: ConversionOptions
): number {
  if (options?.manualTranspose !== undefined) {
    return options.manualTranspose;
  }

  const preserveKey = options?.preserveKey ?? false;
  // If preserveKey is true, only test full octave shifts: -24, -12, 0, 12, 24
  // Otherwise test minimal chromatic shifts covering all 12 keys: -6 to +6
  const candidateOffsets: number[] = preserveKey
    ? [-24, -12, 0, 12, 24]
    : [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

  let bestOffset = 0;
  let minCost = Infinity;

  for (const k of candidateOffsets) {
    let cost = 0;
    for (const note of notes) {
      if (note.isPercussion) continue;
      const effectivePitch = note.pitch - (note.octaveOffset ?? 0) + k;
      if (effectivePitch >= BASE_NOTE_PITCH_MIDI && effectivePitch <= MAX_NOTE_PITCH_MIDI) {
        cost += 0;
      } else {
        const dist = effectivePitch < BASE_NOTE_PITCH_MIDI
          ? (BASE_NOTE_PITCH_MIDI - effectivePitch)
          : (effectivePitch - MAX_NOTE_PITCH_MIDI);
        const octavesAway = Math.ceil(dist / 12);
        const weight = (note.durationSeconds && note.durationSeconds > 0) ? note.durationSeconds : 1.0;
        cost += weight * (1.0 + 0.2 * octavesAway);
      }
    }

    // Tie-breaker prefers smaller absolute displacement |k|
    const tieBreaker = Math.abs(k) * 0.001;
    const totalCost = cost + tieBreaker;

    if (totalCost < minCost) {
      minCost = totalCost;
      bestOffset = k;
    }
  }

  return bestOffset;
}

/**
 * Calculates optimal song-wide transposition for a MidiFile.
 * Conforms to DISPATCH.md interface contract.
 */
export function calculateOptimalTransposition(
  midi: MidiFile,
  preserveKey: boolean = false
): number {
  const melodicNotes: Array<{ pitch: number; durationSeconds: number; octaveOffset: number }> = [];

  for (const track of midi.tracks) {
    if (track.isPercussion || track.channel === 9) continue;
    const mapping = mapMidiInstrument(track.instrumentProgram ?? 0, false);
    for (const note of track.notes) {
      if (note.channel === 9) continue;
      melodicNotes.push({
        pitch: note.pitch,
        durationSeconds: note.durationSeconds,
        octaveOffset: mapping.octaveOffset,
      });
    }
  }

  return findOptimalTransposition(melodicNotes, { preserveKey });
}

// ============================================================================
// 7. MAIN CONVERSION PIPELINE: SONG TIMELINE BUILDER
// ============================================================================

/**
 * Converts a parsed Standard MIDI File into a fully mapped, quantized SongTimeline.
 */
export function convertToSongTimeline(
  midi: MidiFile,
  options?: ConversionOptions
): SongTimeline {
  // 1. Identify primary title & tempo
  let title = 'Minecraft Note Block Song';
  for (const track of midi.tracks) {
    if (track.name && track.name.trim().length > 0 && track.name !== 'Track 0') {
      title = track.name.trim();
      break;
    }
  }

  const initialBpm = midi.tempoMap && midi.tempoMap.length > 0 ? midi.tempoMap[0]!.bpm : 120;

  // 2. Pre-scan tracks to determine default instruments & collect melodic notes for transposition
  const trackInstruments: Map<number, GmInstrumentMapping> = new Map();
  const melodicNotesForOptimization: Array<{ pitch: number; durationSeconds: number; isPercussion: boolean; octaveOffset: number }> = [];

  for (const track of midi.tracks) {
    const isTrackPercussion = Boolean(track.isPercussion || track.channel === 9);
    let mapping: GmInstrumentMapping;

    if (options?.instrumentOverrides && options.instrumentOverrides[track.id]) {
      const overrideInst = options.instrumentOverrides[track.id]!;
      mapping = {
        program: track.instrumentProgram ?? 0,
        name: overrideInst,
        instrument: overrideInst,
        baseBlock: getBaseBlock(overrideInst),
        octaveOffset: getNaturalOctaveOffset(overrideInst),
      };
    } else if (isTrackPercussion) {
      mapping = mapMidiInstrument(0, true);
    } else {
      mapping = mapMidiInstrument(track.instrumentProgram ?? 0, false);
    }
    trackInstruments.set(track.id, mapping);

    if (!isTrackPercussion) {
      for (const note of track.notes) {
        if (note.channel !== 9) {
          melodicNotesForOptimization.push({
            pitch: note.pitch,
            durationSeconds: note.durationSeconds,
            isPercussion: false,
            octaveOffset: mapping.octaveOffset,
          });
        }
      }
    }
  }

  // 3. Compute optimal global key transposition
  const globalTranspose = findOptimalTransposition(melodicNotesForOptimization, options);
  const enableFolding = options?.enableOctaveFolding !== false;

  // 4. Process all note events into NoteBlockEvent items
  const allEvents: NoteBlockEvent[] = [];
  const trackSummaries: TrackSummary[] = [];

  for (const track of midi.tracks) {
    const isTrackPercussion = Boolean(track.isPercussion || track.channel === 9);
    const mapping = trackInstruments.get(track.id) ?? mapMidiInstrument(0, false);
    let trackNoteCount = 0;

    for (const rawNote of track.notes) {
      const isNotePercussion = isTrackPercussion || rawNote.channel === 9;
      let finalInstrument: MinecraftInstrument;
      let finalBaseBlock: string;
      let finalNotePitch: number;

      if (isNotePercussion) {
        // Percussion notes have fixed mappings and are immune to melodic transposition
        const drumMapping = mapMidiPercussion(rawNote.pitch);
        finalInstrument = drumMapping.instrument;
        finalBaseBlock = drumMapping.baseBlock;
        finalNotePitch = drumMapping.note;
      } else {
        finalInstrument = mapping.instrument;
        finalBaseBlock = mapping.baseBlock;
        const transposedPitch = rawNote.pitch + globalTranspose;
        const foldResult = foldToRangeDetailed(transposedPitch, mapping.octaveOffset, enableFolding);
        finalNotePitch = foldResult.note;
      }

      // Enforce strict invariant: 0 <= note <= 24
      finalNotePitch = Math.max(MIN_NOTEBLOCK_PITCH, Math.min(MAX_NOTEBLOCK_PITCH, Math.round(finalNotePitch)));

      const redstoneTick = quantizeToRedstoneTick(rawNote.startSeconds);
      const velocityFactor = Number(Math.max(0.01, Math.min(1.0, rawNote.velocity / 127)).toFixed(3));

      allEvents.push({
        redstoneTick,
        timestampSeconds: rawNote.startSeconds,
        instrument: finalInstrument,
        baseBlock: finalBaseBlock,
        note: finalNotePitch,
        velocity: velocityFactor,
        trackId: track.id,
        channel: rawNote.channel,
      });

      trackNoteCount++;
    }

    trackSummaries.push({
      id: track.id,
      name: track.name || `Track ${track.id}`,
      instrument: mapping.instrument,
      noteCount: trackNoteCount,
      isPercussion: isTrackPercussion,
    });
  }

  // 5. Sort all events chronologically (stable: tick -> time -> track -> note)
  allEvents.sort((a, b) => {
    if (a.redstoneTick !== b.redstoneTick) return a.redstoneTick - b.redstoneTick;
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    if (a.trackId !== b.trackId) return a.trackId - b.trackId;
    return a.note - b.note;
  });

  // 6. Group into eventsByTick Map
  const eventsByTick = new Map<number, NoteBlockEvent[]>();
  for (const event of allEvents) {
    let tickList = eventsByTick.get(event.redstoneTick);
    if (!tickList) {
      tickList = [];
      eventsByTick.set(event.redstoneTick, tickList);
    }
    tickList.push(event);
  }

  // 7. Calculate timeline bounds
  let maxTick = 0;
  if (allEvents.length > 0) {
    maxTick = allEvents[allEvents.length - 1]!.redstoneTick;
  }
  const durationSec = midi.durationSeconds > 0 ? midi.durationSeconds : (maxTick * REDSTONE_TICK_SECONDS);
  const totalRedstoneTicks = Math.max(maxTick, quantizeToRedstoneTick(durationSec));

  return {
    title,
    totalRedstoneTicks,
    durationSeconds: durationSec,
    bpm: initialBpm,
    eventsByTick,
    allEvents,
    tracks: trackSummaries,
  };
}
