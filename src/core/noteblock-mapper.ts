/**
 * src/core/noteblock-mapper.ts
 *
 * Core Note Block Mapping and Quantization Engine.
 * Converts parsed Standard MIDI Files (MidiFile) into a discrete Minecraft
 * SongTimeline with smart pitch transposition, octave folding into [0, 24],
 * instrument timbre mapping (including Channel 9 percussion), and 10 Hz
 * redstone tick quantization.
 *
 * Zero runtime external dependencies.
 */

import {
  MIN_NOTEBLOCK_PITCH,
  MAX_NOTEBLOCK_PITCH,
  INSTRUMENT_METADATA,
  REDSTONE_TICKS_PER_SECOND,
  isMinecraftInstrument,
  type MidiFile,
  type MidiRawNote,
  type MinecraftInstrument,
  type NoteBlockEvent,
  type SongTimeline,
  type TrackSummary,
  type ConversionOptions,
} from './types';

/**
 * Maps General MIDI melodic program (0 - 127) or Channel 9 percussion note
 * to a corresponding Minecraft note block instrument timbre.
 */
export function mapMidiProgramToInstrument(
  program: number,
  isPercussion: boolean,
  midiPitch?: number
): MinecraftInstrument {
  if (isPercussion) {
    if (midiPitch !== undefined) {
      switch (midiPitch) {
        case 35: // Acoustic Bass Drum
        case 36: // Bass Drum 1
        case 41: // Low Floor Tom
        case 43: // High Floor Tom
        case 45: // Low Tom
        case 47: // Low-Mid Tom
        case 48: // Hi-Mid Tom
        case 50: // High Tom
          return 'basedrum';

        case 38: // Acoustic Snare
        case 40: // Electric Snare
          return 'snare';

        case 37: // Side Stick
        case 39: // Hand Clap
        case 42: // Closed Hi-Hat
        case 44: // Pedal Hi-Hat
        case 46: // Open Hi-Hat
        case 49: // Crash Cymbal 1
        case 51: // Ride Cymbal 1
        case 52: // Chinese Cymbal
        case 53: // Ride Bell
        case 55: // Splash Cymbal
        case 57: // Crash Cymbal 2
        case 59: // Ride Cymbal 2
        case 54: // Tambourine
        case 75: // Claves
          return 'hat';

        case 56: // Cowbell
          return 'cow_bell';

        case 76: // Hi Wood Block
        case 77: // Low Wood Block
          return 'xylophone';

        case 80: // Mute Triangle
        case 81: // Open Triangle
          return 'chime';

        default:
          return 'basedrum';
      }
    }
    return 'basedrum';
  }

  // Standard Melodic Instruments (GM Program 0 - 127)
  if (program >= 0 && program <= 3) return 'harp';           // Acoustic Pianos
  if (program >= 4 && program <= 5) return 'pling';          // Electric Piano
  if (program >= 6 && program <= 7) return 'harp';           // Harpsichord, Clavinet
  if (program >= 8 && program <= 10) return 'bell';          // Celesta, Glockenspiel, Music Box
  if (program === 11) return 'iron_xylophone';                // Vibraphone
  if (program >= 12 && program <= 13) return 'xylophone';    // Marimba, Xylophone
  if (program === 14) return 'bell';                         // Tubular Bells
  if (program === 15) return 'xylophone';                    // Dulcimer
  if (program >= 16 && program <= 23) return 'pling';        // Organ
  if (program >= 24 && program <= 31) return 'guitar';       // Guitars
  if (program >= 32 && program <= 39) return 'bass';         // Basses
  if (program >= 40 && program <= 55) return 'harp';         // Strings & Ensembles
  if (program >= 56 && program <= 63) return 'didgeridoo';   // Brass
  if (program >= 64 && program <= 79) return 'flute';        // Reeds & Pipes
  if (program >= 80 && program <= 87) return 'bit';          // Synth Lead
  if (program >= 88 && program <= 95) return 'flute';        // Synth Pad
  if (program >= 96 && program <= 103) return 'bit';         // Synth Effects
  if (program === 105) return 'banjo';                       // Banjo
  if (program >= 104 && program <= 111) return 'guitar';     // Ethnic
  if (program === 115) return 'cow_bell';                    // Woodblock / Steel Drum
  if (program >= 112 && program <= 119) return 'xylophone';  // Percussive Melodic
  return 'harp';
}

/**
 * Maps a single MIDI pitch to Minecraft's 0-24 note block semitone range.
 * Applies optional manual transpose and octave folding.
 */
export function mapMidiPitchToNoteBlock(
  pitch: number,
  instrument: string,
  options?: ConversionOptions
): { note: number; octaveShift: number } {
  const inst = isMinecraftInstrument(instrument) ? instrument : 'harp';
  const info = INSTRUMENT_METADATA[inst] ?? INSTRUMENT_METADATA.harp;
  const baseMinMidi = info.minMidiPitch;

  const transpose = options?.manualTranspose ?? 0;
  const transposedPitch = pitch + transpose;
  let rawNote = transposedPitch - baseMinMidi;
  let octaveShift = 0;

  if (options?.enableOctaveFolding !== false) {
    while (rawNote < MIN_NOTEBLOCK_PITCH) {
      rawNote += 12;
      octaveShift += 1;
    }
    while (rawNote > MAX_NOTEBLOCK_PITCH) {
      rawNote -= 12;
      octaveShift -= 1;
    }
  }

  // Strict clamp guard
  const finalNote = Math.max(
    MIN_NOTEBLOCK_PITCH,
    Math.min(MAX_NOTEBLOCK_PITCH, Math.round(rawNote))
  );

  return {
    note: finalNote,
    octaveShift,
  };
}

/**
 * Quantizes a continuous second timestamp to an integer redstone tick (10 Hz).
 */
export function quantizeToRedstoneTick(seconds: number): number {
  return Math.max(0, Math.round(seconds * REDSTONE_TICKS_PER_SECOND));
}

/**
 * Decomposes an integer delay in redstone ticks into an array of repeater delays (1 - 4 ticks).
 */
export function decomposeRepeaterDelay(deltaTicks: number): number[] {
  if (deltaTicks <= 0) return [];
  const delays: number[] = [];
  let remaining = deltaTicks;
  while (remaining > 0) {
    if (remaining >= 4) {
      delays.push(4);
      remaining -= 4;
    } else {
      delays.push(remaining);
      remaining = 0;
    }
  }
  return delays;
}

/**
 * Determines optimal global transposition offset to minimize out-of-range notes.
 */
function findOptimalGlobalTransposition(
  notes: Array<{ pitch: number; instrument: MinecraftInstrument }>,
  preserveKey: boolean
): number {
  if (notes.length === 0) return 0;

  const candidateOffsets = preserveKey
    ? [-24, -12, 0, 12, 24]
    : [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 12, -12];

  let bestOffset = 0;
  let maxInNaturalRange = -1;

  for (const offset of candidateOffsets) {
    let inNaturalRange = 0;
    for (const note of notes) {
      const minMidi = INSTRUMENT_METADATA[note.instrument].minMidiPitch;
      const raw = note.pitch + offset - minMidi;
      if (raw >= MIN_NOTEBLOCK_PITCH && raw <= MAX_NOTEBLOCK_PITCH) {
        inNaturalRange++;
      }
    }
    if (inNaturalRange > maxInNaturalRange) {
      maxInNaturalRange = inNaturalRange;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

/**
 * Converts a parsed MidiFile into a playable, fully-quantized Minecraft SongTimeline.
 */
export function convertToSongTimeline(
  midi: MidiFile,
  options?: ConversionOptions
): SongTimeline {
  const eventsByTick = new Map<number, NoteBlockEvent[]>();
  const allEvents: NoteBlockEvent[] = [];
  const trackSummaries: TrackSummary[] = [];

  // Determine title from track name or default
  const title =
    midi.tracks.find((t) => t.name && t.name.trim().length > 0 && t.name !== 'Track 0')?.name ||
    'Minecraft Note Block Song';

  // Primary BPM
  const primaryBpm = midi.tempoMap.length > 0 ? midi.tempoMap[0]!.bpm : 120;

  // Track notes with instrument assignments for global transposition calculation
  const preProcessedNotes: Array<{
    rawNote: MidiRawNote;
    trackId: number;
    instrument: MinecraftInstrument;
  }> = [];

  for (const track of midi.tracks) {
    const overrideInst = options?.instrumentOverrides?.[track.id];
    let defaultTrackInst: MinecraftInstrument;

    if (overrideInst && isMinecraftInstrument(overrideInst)) {
      defaultTrackInst = overrideInst;
    } else {
      defaultTrackInst = mapMidiProgramToInstrument(
        track.instrumentProgram,
        track.isPercussion
      );
    }

    let noteCountForTrack = 0;

    for (const note of track.notes) {
      let inst: MinecraftInstrument = defaultTrackInst;
      if (overrideInst && isMinecraftInstrument(overrideInst)) {
        inst = overrideInst;
      } else if (track.isPercussion) {
        inst = mapMidiProgramToInstrument(track.instrumentProgram, true, note.pitch);
      }

      preProcessedNotes.push({
        rawNote: note,
        trackId: track.id,
        instrument: inst,
      });
      noteCountForTrack++;
    }

    trackSummaries.push({
      id: track.id,
      name: track.name || `Track ${track.id}`,
      instrument: defaultTrackInst,
      noteCount: noteCountForTrack,
      isPercussion: track.isPercussion,
    });
  }

  // Determine global transposition if not manually specified
  const effectiveTranspose =
    options?.manualTranspose !== undefined
      ? options.manualTranspose
      : findOptimalGlobalTransposition(
          preProcessedNotes.map((p) => ({ pitch: p.rawNote.pitch, instrument: p.instrument })),
          options?.preserveKey ?? false
        );

  const effectiveOptions: ConversionOptions = {
    ...options,
    manualTranspose: effectiveTranspose,
  };

  // Process all notes into NoteBlockEvents
  for (const item of preProcessedNotes) {
    const { rawNote, trackId, instrument } = item;
    const { note } = mapMidiPitchToNoteBlock(
      rawNote.pitch,
      instrument,
      effectiveOptions
    );

    const redstoneTick = quantizeToRedstoneTick(rawNote.startSeconds);
    const baseBlock = INSTRUMENT_METADATA[instrument].baseBlock;
    const velocity = Math.max(0.1, Math.min(1.0, rawNote.velocity / 127));

    const event: NoteBlockEvent = {
      redstoneTick,
      timestampSeconds: rawNote.startSeconds,
      instrument,
      baseBlock,
      note,
      velocity,
      trackId,
      channel: rawNote.channel,
    };

    allEvents.push(event);

    if (!eventsByTick.has(redstoneTick)) {
      eventsByTick.set(redstoneTick, []);
    }
    eventsByTick.get(redstoneTick)!.push(event);
  }

  // Sort events chronologically by redstoneTick then timestampSeconds
  allEvents.sort((a, b) => {
    if (a.redstoneTick !== b.redstoneTick) return a.redstoneTick - b.redstoneTick;
    return a.timestampSeconds - b.timestampSeconds;
  });

  const totalRedstoneTicks =
    allEvents.length > 0 ? Math.max(...allEvents.map((e) => e.redstoneTick)) : 0;
  const durationSeconds =
    allEvents.length > 0
      ? Math.max(midi.durationSeconds, totalRedstoneTicks / REDSTONE_TICKS_PER_SECOND)
      : 0;

  return {
    title,
    totalRedstoneTicks,
    durationSeconds,
    bpm: primaryBpm,
    eventsByTick,
    allEvents,
    tracks: trackSummaries,
  };
}
