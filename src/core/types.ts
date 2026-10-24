/**
 * src/core/types.ts
 *
 * Core Data Models, Interface Contracts, and Enumerations for
 * MIDI to Minecraft Note Block Converter & Audio Previewer.
 *
 * This module has ZERO runtime external dependencies and is 100% portable
 * across browser client environments and Vitest test suites.
 */

// ============================================================================
// 1. CONSTANTS & PHYSICAL GAME SPECIFICATIONS
// ============================================================================

/** Duration of one Minecraft redstone tick in seconds (10 Hz = 100ms) */
export const REDSTONE_TICK_SECONDS = 0.1;

/** Number of redstone ticks per second */
export const REDSTONE_TICKS_PER_SECOND = 10;

/** Minimum Minecraft note block semitone pitch index */
export const MIN_NOTEBLOCK_PITCH = 0;

/** Maximum Minecraft note block semitone pitch index */
export const MAX_NOTEBLOCK_PITCH = 24;

/** Total semitone pitch span of a Minecraft note block (2 octaves + 1 semitone) */
export const NOTEBLOCK_PITCH_COUNT = 25;

/** MIDI pitch corresponding to note block pitch 0 (F#3) in standard register */
export const BASE_NOTE_PITCH_MIDI = 54;

/** MIDI pitch corresponding to note block pitch 12 (F#4, standard 1.0 pitch multiplier) */
export const CENTER_NOTE_PITCH_MIDI = 66;

/** MIDI pitch corresponding to note block pitch 24 (F#5) in standard register */
export const MAX_NOTE_PITCH_MIDI = 78;

/** Default tempo in microseconds per quarter note (120 BPM) */
export const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000;

/** Default pulses per quarter note (PPQ / time division) */
export const DEFAULT_TICKS_PER_QUARTER = 480;

// ============================================================================
// 2. MIDI DATA TYPES & PARSER CONTRACTS
// ============================================================================

/** Standard MIDI File (SMF) format type */
export type MidiFileFormat = 0 | 1 | 2;

/**
 * Standard MIDI header chunk data.
 */
export interface MidiHeader {
  /** Format 0 (single track), Format 1 (parallel tracks), Format 2 (sequential) */
  format: MidiFileFormat;
  /** Number of track chunks in the file */
  numTracks: number;
  /** Pulses per quarter note (ticks per beat) */
  ticksPerQuarterNote: number;
}

/**
 * Dynamic tempo change event parsed from Meta Event 0x51.
 */
export interface TempoChange {
  /** Absolute tick offset where tempo change occurs */
  tick: number;
  /** Microseconds per quarter note (e.g. 500,000 for 120 BPM) */
  microsecondsPerQuarter: number;
  /** Calculated Beats Per Minute (BPM = 60,000,000 / microsecondsPerQuarter) */
  bpm: number;
  /** Precalculated cumulative elapsed time in seconds at this tempo event */
  seconds: number;
}

/**
 * Time signature event parsed from Meta Event 0x58.
 */
export interface TimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
  clocksPerClick: number;
  thirtySecondsPerQuarter: number;
}

/**
 * Key signature event parsed from Meta Event 0x59.
 */
export interface KeySignature {
  tick: number;
  key: number;       // -7 (7 flats) to +7 (7 sharps)
  scale: 0 | 1;      // 0 = major, 1 = minor
}

/**
 * Raw paired MIDI note event.
 * Constructed by pairing a Note-On (velocity > 0) with its corresponding
 * Note-Off (or Note-On with velocity 0).
 */
export interface MidiRawNote {
  /** MIDI pitch (0 - 127) */
  pitch: number;
  /** Note velocity (1 - 127) */
  velocity: number;
  /** Absolute start time in MIDI ticks */
  startTick: number;
  /** Note duration in MIDI ticks */
  durationTicks: number;
  /** Absolute start time in seconds (calculated via dynamic tempo map) */
  startSeconds: number;
  /** Note duration in seconds (calculated via dynamic tempo map) */
  durationSeconds: number;
  /** MIDI channel index (0 - 15; channel 9 is percussion) */
  channel: number;
  /** General MIDI instrument program assigned to this channel (0 - 127) */
  program: number;
}

/**
 * Parsed MIDI track containing metadata and extracted notes.
 */
export interface MidiTrack {
  /** Track index (0-based) */
  id: number;
  /** Track name (Meta 0x03) or default label */
  name: string;
  /** Primary channel assigned to this track (0 - 15) */
  channel: number;
  /** Primary General MIDI program number (0 - 127) */
  instrumentProgram: number;
  /** Flag indicating whether this track is on percussion channel (channel 9) */
  isPercussion: boolean;
  /** Paired note events in chronological order */
  notes: MidiRawNote[];
  /** Total duration of this track in MIDI ticks */
  totalTicks: number;
}

/**
 * Complete parsed Standard MIDI File representation.
 */
export interface MidiFile {
  format: MidiFileFormat;
  numTracks: number;
  ticksPerQuarterNote: number;
  tracks: MidiTrack[];
  tempoMap: TempoChange[];
  timeSignatures: TimeSignature[];
  keySignatures: KeySignature[];
  /** Total song duration in seconds */
  durationSeconds: number;
  /** Total song duration in MIDI ticks */
  totalTicks: number;
}

// ============================================================================
// 3. MINECRAFT NOTE BLOCK & TIMELINE MODELS
// ============================================================================

/**
 * The 16 vanilla Minecraft Note Block instrument timbres.
 */
export type MinecraftInstrument =
  | 'harp'           // Dirt, Grass, Terracotta (Piano / Harp)
  | 'basedrum'       // Stone, Cobblestone, Deepslate (Kick Drum)
  | 'snare'          // Sand, Gravel, Concrete Powder (Snare Drum)
  | 'hat'            // Glass, Glass Pane, Sea Lantern (Clicks & Sticks)
  | 'bass'           // Wood Planks, Logs, Stems (Double Bass)
  | 'flute'          // Clay block (Flute / Wind)
  | 'bell'           // Block of Gold (Glockenspiel / Bell)
  | 'guitar'         // Wool (Acoustic Guitar)
  | 'chime'          // Packed Ice (Chime / Celesta)
  | 'xylophone'      // Bone Block (Wooden Xylophone)
  | 'iron_xylophone' // Block of Iron (Vibraphone)
  | 'cow_bell'       // Soul Sand (Cowbell)
  | 'didgeridoo'     // Pumpkin, Carved Pumpkin (Didgeridoo / Low Brass)
  | 'bit'            // Block of Emerald (Chiptune Square Wave)
  | 'banjo'          // Hay Block (Banjo / Plucked String)
  | 'pling';         // Glowstone (Electric Piano)

/** Array containing all 16 Minecraft instruments */
export const MINECRAFT_INSTRUMENTS: readonly MinecraftInstrument[] = [
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
] as const;

/**
 * Metadata record for a Minecraft Note Block instrument.
 */
export interface InstrumentInfo {
  name: MinecraftInstrument;
  displayName: string;
  baseBlock: string;
  soundEvent: string;
  octaveOffset: number; // Natural acoustic shift relative to harp (-24 to +24 semitones)
  minMidiPitch: number; // Native MIDI note corresponding to note=0
  maxMidiPitch: number; // Native MIDI note corresponding to note=24
}

/** Complete instrument metadata dictionary */
export const INSTRUMENT_METADATA: Record<MinecraftInstrument, InstrumentInfo> = {
  harp: {
    name: 'harp',
    displayName: 'Piano / Harp',
    baseBlock: 'minecraft:dirt',
    soundEvent: 'minecraft:block.note_block.harp',
    octaveOffset: 0,
    minMidiPitch: 54, // F#3
    maxMidiPitch: 78, // F#5
  },
  bass: {
    name: 'bass',
    displayName: 'Double Bass',
    baseBlock: 'minecraft:oak_planks',
    soundEvent: 'minecraft:block.note_block.bass',
    octaveOffset: -24,
    minMidiPitch: 30, // F#1
    maxMidiPitch: 54, // F#3
  },
  basedrum: {
    name: 'basedrum',
    displayName: 'Bass Drum (Kick)',
    baseBlock: 'minecraft:stone',
    soundEvent: 'minecraft:block.note_block.basedrum',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  snare: {
    name: 'snare',
    displayName: 'Snare Drum',
    baseBlock: 'minecraft:sand',
    soundEvent: 'minecraft:block.note_block.snare',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  hat: {
    name: 'hat',
    displayName: 'Hi-Hat / Click',
    baseBlock: 'minecraft:glass',
    soundEvent: 'minecraft:block.note_block.hat',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  flute: {
    name: 'flute',
    displayName: 'Flute',
    baseBlock: 'minecraft:clay',
    soundEvent: 'minecraft:block.note_block.flute',
    octaveOffset: 12,
    minMidiPitch: 66, // F#4
    maxMidiPitch: 90, // F#6
  },
  bell: {
    name: 'bell',
    displayName: 'Glockenspiel / Bell',
    baseBlock: 'minecraft:gold_block',
    soundEvent: 'minecraft:block.note_block.bell',
    octaveOffset: 24,
    minMidiPitch: 78, // F#5
    maxMidiPitch: 102, // F#7
  },
  guitar: {
    name: 'guitar',
    displayName: 'Acoustic Guitar',
    baseBlock: 'minecraft:white_wool',
    soundEvent: 'minecraft:block.note_block.guitar',
    octaveOffset: -12,
    minMidiPitch: 42, // F#2
    maxMidiPitch: 66, // F#4
  },
  chime: {
    name: 'chime',
    displayName: 'Chime / Celesta',
    baseBlock: 'minecraft:packed_ice',
    soundEvent: 'minecraft:block.note_block.chime',
    octaveOffset: 24,
    minMidiPitch: 78, // F#5
    maxMidiPitch: 102, // F#7
  },
  xylophone: {
    name: 'xylophone',
    displayName: 'Xylophone',
    baseBlock: 'minecraft:bone_block',
    soundEvent: 'minecraft:block.note_block.xylophone',
    octaveOffset: 24,
    minMidiPitch: 78, // F#5
    maxMidiPitch: 102, // F#7
  },
  iron_xylophone: {
    name: 'iron_xylophone',
    displayName: 'Vibraphone',
    baseBlock: 'minecraft:iron_block',
    soundEvent: 'minecraft:block.note_block.iron_xylophone',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  cow_bell: {
    name: 'cow_bell',
    displayName: 'Cowbell',
    baseBlock: 'minecraft:soul_sand',
    soundEvent: 'minecraft:block.note_block.cow_bell',
    octaveOffset: 12,
    minMidiPitch: 66,
    maxMidiPitch: 90,
  },
  didgeridoo: {
    name: 'didgeridoo',
    displayName: 'Didgeridoo',
    baseBlock: 'minecraft:pumpkin',
    soundEvent: 'minecraft:block.note_block.didgeridoo',
    octaveOffset: -24,
    minMidiPitch: 30,
    maxMidiPitch: 54,
  },
  bit: {
    name: 'bit',
    displayName: 'Chiptune (Square Wave)',
    baseBlock: 'minecraft:emerald_block',
    soundEvent: 'minecraft:block.note_block.bit',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  banjo: {
    name: 'banjo',
    displayName: 'Banjo',
    baseBlock: 'minecraft:hay_block',
    soundEvent: 'minecraft:block.note_block.banjo',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
  pling: {
    name: 'pling',
    displayName: 'Electric Piano',
    baseBlock: 'minecraft:glowstone',
    soundEvent: 'minecraft:block.note_block.pling',
    octaveOffset: 0,
    minMidiPitch: 54,
    maxMidiPitch: 78,
  },
};

/**
 * A single playable Minecraft Note Block sound event.
 * Mapped from raw MIDI notes and quantized to redstone ticks.
 */
export interface NoteBlockEvent {
  /** Quantized integer redstone tick (0.1s increments: 0, 1, 2, ...) */
  redstoneTick: number;
  /** High-precision onset timestamp in continuous seconds (for Web Audio scheduling) */
  timestampSeconds: number;
  /** Minecraft instrument timbre */
  instrument: MinecraftInstrument;
  /** Minecraft block placed at Y-1 underneath the note block */
  baseBlock: string;
  /** Minecraft semitone pitch value (strictly 0 to 24) */
  note: number;
  /** Velocity normalized to [0.0, 1.0] volume factor */
  velocity: number;
  /** Originating MIDI track ID */
  trackId: number;
  /** Originating MIDI channel (0-15) */
  channel?: number;
}

/**
 * Summary metadata for an individual track within the converted song.
 */
export interface TrackSummary {
  id: number;
  name: string;
  instrument: MinecraftInstrument;
  noteCount: number;
  isPercussion: boolean;
}

/**
 * Complete converted song timeline.
 * Serves as the central data contract between Note Block Mapper,
 * Schematic Exporters, and Audio Preview Player.
 */
export interface SongTimeline {
  /** Song title */
  title: string;
  /** Total length in quantized redstone ticks */
  totalRedstoneTicks: number;
  /** Total length in seconds */
  durationSeconds: number;
  /** Primary tempo in BPM */
  bpm: number;
  /** Map of redstone tick index to array of simultaneous note events */
  eventsByTick: Map<number, NoteBlockEvent[]>;
  /** Chronologically sorted list of all note events */
  allEvents: NoteBlockEvent[];
  /** Track listing and summary information */
  tracks: TrackSummary[];
}

// ============================================================================
// 4. CONVERSION & MAPPING OPTIONS
// ============================================================================

/**
 * Options configuring the Note Block conversion pipeline.
 */
export interface ConversionOptions {
  /**
   * If true, restricts global key optimization to full octave shifts
   * (-24, -12, 0, +12, +24), strictly preserving the original musical key.
   * Default: false (allows semitone transpositions to maximize in-range notes).
   */
  preserveKey?: boolean;

  /**
   * Manual transposition offset in semitones (-24 to +24).
   * Overrides automatic optimal transposition if specified.
   */
  manualTranspose?: number;

  /**
   * Whether to fold out-of-range notes into the 0-24 semitone window.
   * Default: true.
   */
  enableOctaveFolding?: boolean;

  /**
   * Whether to adjust song tempo to snap to integer redstone tick intervals,
   * eliminating rhythmic tick-rounding jitter.
   * Default: false.
   */
  snapTempoToGrid?: boolean;

  /**
   * Per-track instrument overrides: Track ID -> MinecraftInstrument.
   */
  instrumentOverrides?: Record<number, MinecraftInstrument>;
}

// ============================================================================
// 5. SCHEMATIC EXPORT & 3D CIRCUIT LAYOUT TYPES
// ============================================================================

/** 3D integer coordinate in block space */
export interface BlockCoord {
  x: number;
  y: number;
  z: number;
}

/** 3D bounding dimensions of a schematic */
export interface SchematicDimensions {
  /** Width along X-axis */
  width: number;
  /** Height along Y-axis (typically 3: substrate, circuit, clearance) */
  height: number;
  /** Length along Z-axis */
  length: number;
}

/**
 * Single block placement entry for circuit generation.
 */
export interface BlockPlacement {
  pos: BlockCoord;
  /** Full block state string (e.g. 'minecraft:note_block[instrument=harp,note=12,powered=false]') */
  blockState: string;
}

/**
 * Options configuring schematic layout and file generation.
 */
export interface SchematicExportOptions {
  /** Name of the schematic file and internal song title */
  name: string;
  /** Author metadata tag (default: 'MidiToNoteBlock') */
  author?: string;
  /** Maximum width in blocks for the serpentine zigzag layout (default: 16) */
  maxTrackWidth?: number;
  /** Maximum length per lane in blocks before turning (default: 40) */
  maxTrackLength?: number;
  /** Whether to ensure support blocks beneath gravity blocks like sand (default: true) */
  supportGravityBlocks?: boolean;
  /** Target Sponge format version: 2 (universal) or 3 (modern). Default: 2 */
  spongeVersion?: 2 | 3;
}

/**
 * Output result from schematic generation.
 */
export interface SchematicResult {
  /** Recommended filename with appropriate extension (.schem or .litematic) */
  filename: string;
  /** MIME type for browser blob download */
  mimeType: string;
  /** Gzip-compressed binary NBT payload */
  data: Uint8Array;
  /** Physical 3D bounding dimensions */
  dimensions: SchematicDimensions;
  /** Total count of note blocks in the circuit */
  totalNoteBlocks: number;
  /** Total count of redstone repeaters in the circuit */
  totalRepeaters: number;
}

/**
 * Physical repeater facing orientation.
 */
export type RepeaterFacing = 'north' | 'south' | 'east' | 'west';

/**
 * Internal 3D circuit node representing circuit blocks.
 */
export interface CircuitNode {
  pos: BlockCoord;
  blockState: string;
  tick?: number;
  delay?: 1 | 2 | 3 | 4;
  facing?: RepeaterFacing;
}

/**
 * Internal 3D circuit grid map before binary encoding.
 */
export interface CircuitGrid {
  dimensions: SchematicDimensions;
  /** Keyed by "x,y,z" -> blockState string */
  blocks: Map<string, string>;
  totalNoteBlocks: number;
  totalRepeaters: number;
}

// ============================================================================
// 6. AUDIO PREVIEW & TRANSPORT ENGINE TYPES
// ============================================================================

/** Audio preview playback synthesizer mode */
export type PlaybackMode = 'sample' | 'synth';

/** Audio transport playback state */
export type TransportState = 'stopped' | 'playing' | 'paused';

/**
 * Live state of the Web Audio preview player.
 */
export interface AudioPlayerState {
  /** Overall transport status */
  status: TransportState;
  /** True if currently playing */
  isPlaying: boolean;
  /** True if playback is paused */
  isPaused: boolean;
  /** Current playback cursor in seconds */
  currentTime: number;
  /** Total song duration in seconds */
  duration: number;
  /** Current quantized redstone tick index */
  currentRedstoneTick: number;
  /** Master volume factor [0.0, 1.0] */
  volume: number;
  /** Playback speed multiplier (e.g. 0.5 to 2.0, default: 1.0) */
  playbackSpeed: number;
  /** Audio voice mode ('sample' or 'synth') */
  mode: PlaybackMode;
  /** Set of track IDs currently muted */
  mutedTracks: Set<number>;
  /** Set of track IDs currently soloed */
  soloTracks: Set<number>;
}

/**
 * Public interface contract for the Web Audio Preview Engine.
 */
export interface AudioPlayer {
  /** Loads a converted SongTimeline into the player */
  loadSong(song: SongTimeline): Promise<void>;

  /** Begins or resumes audio playback */
  play(): Promise<void>;

  /** Pauses audio playback at current position */
  pause(): void;

  /** Stops playback and resets cursor to 0 */
  stop(): void;

  /** Seeks playback to a specific timestamp in seconds */
  seek(seconds: number): void;

  /** Sets master volume in range [0.0, 1.0] */
  setVolume(volume: number): void;

  /** Sets playback speed multiplier (e.g. 0.5 to 2.0) */
  setSpeed(speed: number): void;

  /** Toggles track mute state */
  setTrackMute(trackId: number, muted: boolean): void;

  /** Toggles track solo state */
  setTrackSolo(trackId: number, soloed: boolean): void;

  /** Sets synthesis voice mode ('sample' or 'synth') */
  setPlaybackMode(mode: PlaybackMode): void;

  /** Retrieves the instantaneous player state */
  getState(): AudioPlayerState;

  /** Registers a recurring tick callback (invoked on UI updates) */
  onTick(callback: (state: AudioPlayerState) => void): () => void;

  /** Registers a callback triggered when playback reaches the end of the song */
  onEnded(callback: () => void): () => void;

  /** Cleans up audio nodes, timers, and releases audio resources */
  dispose(): void;
}

// ============================================================================
// 7. BINARY NBT SERIALIZATION AST & TYPES
// ============================================================================

/**
 * Standard Minecraft Named Binary Tag (NBT) Tag IDs.
 */
export enum NbtTagType {
  TAG_End = 0,
  TAG_Byte = 1,
  TAG_Short = 2,
  TAG_Int = 3,
  TAG_Long = 4,
  TAG_Float = 5,
  TAG_Double = 6,
  TAG_Byte_Array = 7,
  TAG_String = 8,
  TAG_List = 9,
  TAG_Compound = 10,
  TAG_Int_Array = 11,
  TAG_Long_Array = 12,
}

/** Generic NBT payload value */
export type NbtValue =
  | number                         // TAG_Byte, TAG_Short, TAG_Int, TAG_Float, TAG_Double
  | bigint                         // TAG_Long
  | string                         // TAG_String
  | Uint8Array                     // TAG_Byte_Array
  | Int32Array                     // TAG_Int_Array
  | BigInt64Array | BigUint64Array // TAG_Long_Array
  | NbtCompoundPayload             // TAG_Compound
  | NbtListPayload;                // TAG_List

/** Internal payload structure for NBT Compounds */
export interface NbtCompoundPayload {
  [tagName: string]: {
    type: NbtTagType;
    value: NbtValue;
  };
}

/** Internal payload structure for NBT Lists */
export interface NbtListPayload {
  elementType: NbtTagType;
  items: NbtValue[];
}

// ============================================================================
// 8. PITCH UTILITY FUNCTIONS (TYPE GUARDS & MATH)
// ============================================================================

/**
 * Calculates the exact Minecraft Web Audio playback rate multiplier:
 * playbackRate = 2^((note - 12) / 12)
 *
 * @param note Semitone pitch index in range [0, 24]
 * @returns Rate multiplier in range [0.5, 2.0]
 */
export function calculateNoteBlockPitchMultiplier(note: number): number {
  return Math.pow(2, (note - 12) / 12);
}

/**
 * Type guard verifying if an unknown value is a valid MinecraftInstrument.
 */
export function isMinecraftInstrument(value: unknown): value is MinecraftInstrument {
  return typeof value === 'string' && MINECRAFT_INSTRUMENTS.includes(value as MinecraftInstrument);
}

/**
 * Validates that a note integer is strictly within Minecraft's 0 to 24 semitone range.
 */
export function isValidNoteBlockPitch(note: number): boolean {
  return Number.isInteger(note) && note >= MIN_NOTEBLOCK_PITCH && note <= MAX_NOTEBLOCK_PITCH;
}
