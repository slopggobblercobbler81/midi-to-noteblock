/**
 * tests/fixtures/midi-generator.ts
 *
 * Synthetic Standard MIDI File (SMF 0 & 1) Binary Generator.
 * Used by E2E test suites as an authoritative test oracle to generate
 * authentic MIDI byte buffers adhering strictly to the MIDI 1.0 Specification.
 *
 * Zero external dependencies: uses native Uint8Array and DataView.
 */

export interface MidiNoteSpec {
  pitch: number;        // 0 - 127
  velocity?: number;    // 1 - 127 (default: 80)
  startTick: number;
  durationTicks: number;
  channel?: number;     // 0 - 15 (default: 0)
}

export interface MidiTempoSpec {
  tick: number;
  microsecondsPerQuarter: number; // e.g. 500000 for 120 BPM
}

export interface MidiTrackSpec {
  name?: string;
  channel?: number;
  program?: number;     // 0 - 127 General MIDI instrument
  isPercussion?: boolean; // If true, channel 9
  notes: MidiNoteSpec[];
  tempoEvents?: MidiTempoSpec[];
  useRunningStatus?: boolean;
  useZeroVelocityNoteOff?: boolean;
}

export interface MidiFileSpec {
  format: 0 | 1;
  ticksPerQuarterNote: number; // e.g. 480
  tracks: MidiTrackSpec[];
}

/**
 * Encodes an unsigned integer into Variable-Length Quantity (VLQ) bytes.
 * Up to 28-bit integers (4 bytes maximum).
 */
export function encodeVLQ(value: number): number[] {
  let val = Math.max(0, Math.floor(value)) >>> 0;
  if (val === 0) return [0];

  const bytes: number[] = [];
  bytes.push(val & 0x7f);
  val >>>= 7;

  while (val > 0) {
    bytes.unshift((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  return bytes;
}

/**
 * Internal raw MIDI track event before delta-time calculation.
 */
interface RawTimedEvent {
  tick: number;
  type: 'note-on' | 'note-off' | 'tempo' | 'program' | 'track-name' | 'end-of-track';
  channel: number;
  pitch?: number;
  velocity?: number;
  tempoMicros?: number;
  program?: number;
  text?: string;
}

/**
 * Serializes a single track chunk into an MTrk binary buffer.
 */
function serializeTrackChunk(
  trackSpec: MidiTrackSpec,
  options?: { omitEndOfTrack?: boolean; forceRunningStatus?: boolean }
): Uint8Array {
  const events: RawTimedEvent[] = [];
  const defaultChannel = trackSpec.isPercussion ? 9 : (trackSpec.channel ?? 0);

  // Track Name meta event at tick 0
  if (trackSpec.name) {
    events.push({
      tick: 0,
      type: 'track-name',
      channel: defaultChannel,
      text: trackSpec.name,
    });
  }

  // Program change at tick 0
  if (trackSpec.program !== undefined && !trackSpec.isPercussion) {
    events.push({
      tick: 0,
      type: 'program',
      channel: defaultChannel,
      program: trackSpec.program,
    });
  }

  // Tempo changes in this track
  if (trackSpec.tempoEvents) {
    for (const t of trackSpec.tempoEvents) {
      events.push({
        tick: t.tick,
        type: 'tempo',
        channel: 0,
        tempoMicros: t.microsecondsPerQuarter,
      });
    }
  }

  // Note On and Note Off events
  for (const n of trackSpec.notes) {
    const ch = n.channel ?? defaultChannel;
    const vel = n.velocity ?? 80;
    events.push({
      tick: n.startTick,
      type: 'note-on',
      channel: ch,
      pitch: n.pitch,
      velocity: vel,
    });

    events.push({
      tick: n.startTick + n.durationTicks,
      type: 'note-off',
      channel: ch,
      pitch: n.pitch,
      velocity: 0,
    });
  }

  // Sort events chronologically. For identical ticks, order: tempo/meta -> note-off -> note-on
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const orderScore = (ev: RawTimedEvent): number => {
      if (ev.type === 'tempo' || ev.type === 'track-name') return 0;
      if (ev.type === 'note-off') return 1;
      if (ev.type === 'program') return 2;
      return 3; // note-on
    };
    return orderScore(a) - orderScore(b);
  });

  const byteStream: number[] = [];
  let currentTick = 0;
  let lastStatus: number | null = null;
  const useRunningStatus = options?.forceRunningStatus ?? trackSpec.useRunningStatus ?? false;
  const useZeroVelocity = trackSpec.useZeroVelocityNoteOff ?? false;

  for (const ev of events) {
    const delta = ev.tick - currentTick;
    currentTick = ev.tick;

    // Delta-time VLQ
    byteStream.push(...encodeVLQ(delta));

    if (ev.type === 'tempo') {
      // Meta Event 0x51: 0xFF 0x51 0x03 [3-byte micros]
      const micros = ev.tempoMicros ?? 500000;
      byteStream.push(0xff, 0x51, 0x03);
      byteStream.push((micros >>> 16) & 0xff);
      byteStream.push((micros >>> 8) & 0xff);
      byteStream.push(micros & 0xff);
      lastStatus = null;
    } else if (ev.type === 'track-name') {
      // Meta Event 0x03: 0xFF 0x03 len text
      const enc = new TextEncoder().encode(ev.text ?? '');
      byteStream.push(0xff, 0x03, ...encodeVLQ(enc.length), ...enc);
      lastStatus = null;
    } else if (ev.type === 'program') {
      // Program Change: 0xCn program
      const status = 0xc0 | (ev.channel & 0x0f);
      if (!useRunningStatus || lastStatus !== status) {
        byteStream.push(status);
        lastStatus = status;
      }
      byteStream.push((ev.program ?? 0) & 0x7f);
    } else if (ev.type === 'note-on') {
      // Note On: 0x9n pitch vel
      const status = 0x90 | (ev.channel & 0x0f);
      if (!useRunningStatus || lastStatus !== status) {
        byteStream.push(status);
        lastStatus = status;
      }
      byteStream.push((ev.pitch ?? 60) & 0x7f);
      byteStream.push((ev.velocity ?? 80) & 0x7f);
    } else if (ev.type === 'note-off') {
      if (useZeroVelocity) {
        // Zero-velocity Note-On (0x9n pitch 0x00)
        const status = 0x90 | (ev.channel & 0x0f);
        if (!useRunningStatus || lastStatus !== status) {
          byteStream.push(status);
          lastStatus = status;
        }
        byteStream.push((ev.pitch ?? 60) & 0x7f);
        byteStream.push(0x00);
      } else {
        // Standard Note-Off (0x8n pitch 0x40)
        const status = 0x80 | (ev.channel & 0x0f);
        if (!useRunningStatus || lastStatus !== status) {
          byteStream.push(status);
          lastStatus = status;
        }
        byteStream.push((ev.pitch ?? 60) & 0x7f);
        byteStream.push(0x40);
      }
    }
  }

  // Mandatory End of Track: 0x00 0xFF 0x2F 0x00
  if (!options?.omitEndOfTrack) {
    byteStream.push(0x00, 0xff, 0x2f, 0x00);
  }

  // Construct MTrk chunk
  const chunkLen = byteStream.length;
  const chunk = new Uint8Array(8 + chunkLen);
  // 'MTrk' magic: 0x4D 0x54 0x72 0x6B
  chunk[0] = 0x4d;
  chunk[1] = 0x54;
  chunk[2] = 0x72;
  chunk[3] = 0x6b;
  // 4-byte chunk length (big-endian)
  const view = new DataView(chunk.buffer);
  view.setUint32(4, chunkLen, false);
  chunk.set(byteStream, 8);

  return chunk;
}

/**
 * Builds a complete Standard MIDI File (SMF 0 or 1) binary buffer.
 */
export function generateMidiBinary(
  spec: MidiFileSpec,
  options?: { omitEndOfTrack?: boolean; forceRunningStatus?: boolean; corruptHeader?: boolean }
): Uint8Array {
  const trackChunks = spec.tracks.map((t) => serializeTrackChunk(t, options));
  const totalTrackBytes = trackChunks.reduce((acc, c) => acc + c.length, 0);

  // MThd header is always 14 bytes:
  // 4 bytes 'MThd', 4 bytes length (6), 2 bytes format, 2 bytes numTracks, 2 bytes time division
  const totalSize = 14 + totalTrackBytes;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // 'MThd' magic
  if (options?.corruptHeader) {
    buffer[0] = 0x42; // Corrupted magic 'BAD!'
    buffer[1] = 0x41;
    buffer[2] = 0x44;
    buffer[3] = 0x21;
  } else {
    buffer[0] = 0x4d;
    buffer[1] = 0x54;
    buffer[2] = 0x68;
    buffer[3] = 0x64;
  }

  // Header chunk length: 6
  view.setUint32(4, 6, false);
  // Format: 0 or 1
  view.setUint16(8, spec.format, false);
  // NumTracks
  view.setUint16(10, spec.tracks.length, false);
  // Division (PPQ)
  view.setUint16(12, spec.ticksPerQuarterNote, false);

  let offset = 14;
  for (const trackChunk of trackChunks) {
    buffer.set(trackChunk, offset);
    offset += trackChunk.length;
  }

  return buffer;
}

// ============================================================================
// PRESET SYNTHETIC MIDI FIXTURES
// ============================================================================

/**
 * Fixture 1: SMF Format 0 Single Track (C-Major scale, 120 BPM, 480 PPQ)
 */
export function createMonophonicFormat0(): Uint8Array {
  // C4 (60), D4 (62), E4 (64), F4 (65), G4 (67), A4 (69), B4 (71), C5 (72)
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
  const notes: MidiNoteSpec[] = pitches.map((pitch, idx) => ({
    pitch,
    startTick: idx * 480,
    durationTicks: 400,
    velocity: 90,
  }));

  return generateMidiBinary({
    format: 0,
    ticksPerQuarterNote: 480,
    tracks: [
      {
        name: 'Monophonic C Major',
        program: 0, // Acoustic Grand Piano
        notes,
        tempoEvents: [{ tick: 0, microsecondsPerQuarter: 500000 }], // 120 BPM
      },
    ],
  });
}

/**
 * Fixture 2: SMF Format 1 Multi-Track Polyphonic with Dynamic Tempo
 * Track 0: Tempo changes (120 BPM -> 150 BPM at tick 960)
 * Track 1: Melody (Flute / Clay)
 * Track 2: Bassline (Acoustic Bass / Wood)
 * Track 3: Chords (Electric Piano / Glowstone)
 */
export function createPolyphonicFormat1(): Uint8Array {
  return generateMidiBinary({
    format: 1,
    ticksPerQuarterNote: 480,
    tracks: [
      // Track 0: Conductor (Tempo & Metronome)
      {
        name: 'Tempo Track',
        notes: [],
        tempoEvents: [
          { tick: 0, microsecondsPerQuarter: 500000 },   // 120 BPM
          { tick: 960, microsecondsPerQuarter: 400000 }, // 150 BPM at measure 3
        ],
      },
      // Track 1: Melody (Flute, Program 73)
      {
        name: 'Lead Melody',
        program: 73,
        channel: 0,
        notes: [
          { pitch: 72, startTick: 0, durationTicks: 240, velocity: 100 },
          { pitch: 74, startTick: 240, durationTicks: 240, velocity: 95 },
          { pitch: 76, startTick: 480, durationTicks: 480, velocity: 110 },
          { pitch: 79, startTick: 960, durationTicks: 480, velocity: 105 },
          { pitch: 76, startTick: 1440, durationTicks: 480, velocity: 100 },
        ],
      },
      // Track 2: Bassline (Acoustic Bass, Program 32)
      {
        name: 'Bassline',
        program: 32,
        channel: 1,
        notes: [
          { pitch: 36, startTick: 0, durationTicks: 480, velocity: 85 },
          { pitch: 41, startTick: 480, durationTicks: 480, velocity: 85 },
          { pitch: 43, startTick: 960, durationTicks: 480, velocity: 90 },
          { pitch: 36, startTick: 1440, durationTicks: 480, velocity: 85 },
        ],
      },
      // Track 3: Polyphonic Chords (Electric Piano, Program 4)
      {
        name: 'Chords',
        program: 4,
        channel: 2,
        notes: [
          // C Major Chord (C4, E4, G4) on tick 0
          { pitch: 60, startTick: 0, durationTicks: 480, velocity: 75 },
          { pitch: 64, startTick: 0, durationTicks: 480, velocity: 75 },
          { pitch: 67, startTick: 0, durationTicks: 480, velocity: 75 },
          // F Major Chord (F4, A4, C5) on tick 480
          { pitch: 65, startTick: 480, durationTicks: 480, velocity: 75 },
          { pitch: 69, startTick: 480, durationTicks: 480, velocity: 75 },
          { pitch: 72, startTick: 480, durationTicks: 480, velocity: 75 },
          // G Major Chord (G4, B4, D5) on tick 960
          { pitch: 67, startTick: 960, durationTicks: 480, velocity: 80 },
          { pitch: 71, startTick: 960, durationTicks: 480, velocity: 80 },
          { pitch: 74, startTick: 960, durationTicks: 480, velocity: 80 },
        ],
      },
    ],
  });
}

/**
 * Fixture 3: Channel 9 Percussion Track
 * GM Drum notes: 36 (Bass Drum), 38 (Snare), 42 (Closed Hi-Hat), 56 (Cowbell)
 */
export function createPercussionMidi(): Uint8Array {
  const notes: MidiNoteSpec[] = [
    // Measure 1: Kick on 1 & 3, Snare on 2 & 4, Hi-hat on all 8ths
    { pitch: 36, startTick: 0, durationTicks: 120, velocity: 110, channel: 9 },
    { pitch: 42, startTick: 0, durationTicks: 120, velocity: 80, channel: 9 },
    { pitch: 42, startTick: 240, durationTicks: 120, velocity: 70, channel: 9 },
    { pitch: 38, startTick: 480, durationTicks: 120, velocity: 100, channel: 9 },
    { pitch: 42, startTick: 480, durationTicks: 120, velocity: 80, channel: 9 },
    { pitch: 42, startTick: 720, durationTicks: 120, velocity: 70, channel: 9 },
    { pitch: 36, startTick: 960, durationTicks: 120, velocity: 110, channel: 9 },
    { pitch: 42, startTick: 960, durationTicks: 120, velocity: 80, channel: 9 },
    { pitch: 56, startTick: 1200, durationTicks: 120, velocity: 120, channel: 9 }, // Cowbell
    { pitch: 38, startTick: 1440, durationTicks: 120, velocity: 100, channel: 9 },
  ];

  return generateMidiBinary({
    format: 1,
    ticksPerQuarterNote: 480,
    tracks: [
      {
        name: 'Drum Kit',
        isPercussion: true,
        channel: 9,
        notes,
        tempoEvents: [{ tick: 0, microsecondsPerQuarter: 500000 }],
      },
    ],
  });
}

/**
 * Fixture 4: Boundary & Adversarial MIDI
 * Tests extreme pitches (0, 127), running status, zero-velocity note-ons, rapid tempo events.
 */
export function createAdversarialMidi(): Uint8Array {
  return generateMidiBinary(
    {
      format: 0,
      ticksPerQuarterNote: 480,
      tracks: [
        {
          name: 'Stress Test Track',
          useRunningStatus: true,
          useZeroVelocityNoteOff: true,
          tempoEvents: [
            { tick: 0, microsecondsPerQuarter: 500000 },
            { tick: 240, microsecondsPerQuarter: 250000 }, // 240 BPM
            { tick: 480, microsecondsPerQuarter: 1000000 }, // 60 BPM
          ],
          notes: [
            { pitch: 0, startTick: 0, durationTicks: 120, velocity: 1 },
            { pitch: 127, startTick: 120, durationTicks: 120, velocity: 127 },
            { pitch: 21, startTick: 240, durationTicks: 60, velocity: 64 }, // A0 (lowest 88-key piano)
            { pitch: 108, startTick: 300, durationTicks: 60, velocity: 64 }, // C8 (highest 88-key piano)
            // Dense 10-note simultaneous cluster chord at tick 480
            { pitch: 48, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 50, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 52, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 53, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 55, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 57, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 59, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 60, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 62, startTick: 480, durationTicks: 240, velocity: 80 },
            { pitch: 64, startTick: 480, durationTicks: 240, velocity: 80 },
          ],
        },
      ],
    },
    { forceRunningStatus: true }
  );
}
