/**
 * src/core/midi-parser.ts
 *
 * Pure Client-Side Zero-Dependency Standard MIDI File (SMF) Parser & Timeline Engine.
 *
 * Features:
 * - Native DataView / Uint8Array binary chunk parsing (MThd, MTrk, RIFF/RMID)
 * - Safe 7-bit continuation Variable-Length Quantity (VLQ) decoding with 28-bit overflow guards
 * - Running status tracking with strict reset rules on Meta/SysEx events
 * - Zero-velocity Note-On normalization to Note-Off
 * - 11-bit composite integer keyed FIFO polyphonic note pairing engine
 * - Piecewise-linear Dynamic Tempo Map with O(log K) binary search
 * - Extraction of Tempo, Time Signature, Key Signature, Track Names, and Instruments
 * - Channel 9 percussion detection
 * - 100% strict TypeScript typing (Zero 'any', noUncheckedIndexedAccess compliant)
 */

import {
  DEFAULT_MICROSECONDS_PER_QUARTER,
  DEFAULT_TICKS_PER_QUARTER,
  REDSTONE_TICKS_PER_SECOND,
  type KeySignature,
  type MidiFile,
  type MidiFileFormat,
  type MidiHeader,
  type MidiRawNote,
  type MidiTrack,
  type TempoChange,
  type TimeSignature,
} from './types';

// ============================================================================
// 1. ERROR TYPES & RAW DATA STRUCTURES
// ============================================================================

/**
 * Custom error class for MIDI format, header, or byte stream corruption.
 */
export class InvalidMidiError extends Error {
  public readonly byteOffset?: number;

  constructor(message: string, byteOffset?: number) {
    super(byteOffset !== undefined ? `${message} (at byte offset ${byteOffset})` : message);
    this.name = 'InvalidMidiError';
    this.byteOffset = byteOffset;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raw chunk descriptor discovered in SMF container.
 */
export interface RawMidiChunk {
  type: string;
  offset: number;
  declaredLength: number;
  actualLength: number;
}

/**
 * Low-level parsed MIDI event prior to high-level timeline synthesis.
 */
export type RawMidiEvent =
  | { type: 'noteOn'; tick: number; channel: number; pitch: number; velocity: number }
  | { type: 'noteOff'; tick: number; channel: number; pitch: number; velocity: number }
  | { type: 'programChange'; tick: number; channel: number; program: number }
  | { type: 'controlChange'; tick: number; channel: number; controller: number; value: number }
  | { type: 'pitchBend'; tick: number; channel: number; value: number }
  | { type: 'setTempo'; tick: number; microsecondsPerQuarter: number; bpm: number }
  | {
      type: 'timeSignature';
      tick: number;
      numerator: number;
      denominator: number;
      clocksPerClick: number;
      thirtySecondsPerQuarter: number;
    }
  | { type: 'keySignature'; tick: number; key: number; scale: 0 | 1 }
  | { type: 'trackName'; tick: number; text: string }
  | { type: 'instrumentName'; tick: number; text: string }
  | { type: 'endOfTrack'; tick: number }
  | { type: 'sysEx'; tick: number; data: Uint8Array }
  | { type: 'metaOther'; tick: number; metaType: number; data: Uint8Array };

// ============================================================================
// 2. LOW-LEVEL BYTE READERS & VLQ DECODING
// ============================================================================

/**
 * Safely decodes a 7-bit continuation Variable-Length Quantity (VLQ) from DataView.
 * Uses arithmetic multiplication to prevent signed 32-bit bitshift overflow.
 * Enforces bounds and max 4-byte MIDI specification limit.
 */
export function readVariableLengthQuantity(
  view: DataView,
  offset: number,
  endOffset: number
): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;

  while (offset + bytesRead < endOffset && bytesRead < 4) {
    const byte = view.getUint8(offset + bytesRead);
    bytesRead++;
    value = value * 128 + (byte & 0x7f);

    if ((byte & 0x80) === 0) {
      return { value, bytesRead };
    }
  }

  return { value, bytesRead };
}

/**
 * Decodes a 7-bit continuation Variable-Length Quantity (VLQ) from an array or Uint8Array.
 */
export function decodeVLQ(
  data: Uint8Array | readonly number[],
  offset = 0
): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  const len = data.length;

  while (offset + bytesRead < len && bytesRead < 4) {
    const byte = data[offset + bytesRead] ?? 0;
    bytesRead++;
    value = value * 128 + (byte & 0x7f);

    if ((byte & 0x80) === 0) {
      return { value, bytesRead };
    }
  }

  return { value, bytesRead };
}

/**
 * Reads an ASCII string of specified length from DataView.
 */
export function readAsciiString(view: DataView, offset: number, length: number): string {
  let result = '';
  const limit = Math.min(offset + length, view.byteLength);
  for (let i = offset; i < limit; i++) {
    result += String.fromCharCode(view.getUint8(i));
  }
  return result;
}

// ============================================================================
// 3. HEADER VALIDATION & CHUNK SCANNING
// ============================================================================

/**
 * Validates and parses the 14-byte MThd chunk header.
 */
export function parseMidiHeader(
  view: DataView,
  startOffset = 0
): { header: MidiHeader; nextOffset: number } {
  if (view.byteLength - startOffset < 14) {
    throw new InvalidMidiError('File is too short to contain a valid MIDI header', startOffset);
  }

  const magic = readAsciiString(view, startOffset, 4);
  if (magic !== 'MThd') {
    throw new InvalidMidiError(
      `Not a standard MIDI file: expected 'MThd' chunk header magic, found '${magic}'`,
      startOffset
    );
  }

  const headerLength = view.getUint32(startOffset + 4, false);
  if (headerLength < 6) {
    throw new InvalidMidiError(
      `Invalid header length in MThd chunk: ${headerLength}`,
      startOffset + 4
    );
  }

  const rawFormat = view.getUint16(startOffset + 8, false);
  if (rawFormat !== 0 && rawFormat !== 1 && rawFormat !== 2) {
    throw new InvalidMidiError(`Unsupported MIDI file format: ${rawFormat}`, startOffset + 8);
  }
  const format = rawFormat as MidiFileFormat;

  const numTracks = view.getUint16(startOffset + 10, false);
  const division = view.getUint16(startOffset + 12, false);

  let ticksPerQuarterNote = DEFAULT_TICKS_PER_QUARTER;
  if ((division & 0x8000) === 0) {
    ticksPerQuarterNote = division > 0 ? division : DEFAULT_TICKS_PER_QUARTER;
  } else {
    // SMPTE division fallback: bit 15 is 1
    const fpsByte = (division >> 8) & 0xff;
    const fps = -(fpsByte > 127 ? fpsByte - 256 : fpsByte);
    const subframes = division & 0xff;
    ticksPerQuarterNote =
      fps > 0 && subframes > 0 ? Math.round(fps * subframes * 0.5) : DEFAULT_TICKS_PER_QUARTER;
  }

  // Advance past 8-byte chunk header + headerLength (skipping any extended header padding)
  const nextOffset = startOffset + 8 + headerLength;

  return {
    header: {
      format,
      numTracks,
      ticksPerQuarterNote,
    },
    nextOffset,
  };
}

/**
 * Scans binary container for all MTrk chunks, safely skipping non-track chunks (e.g. RIFF, LIST).
 */
export function scanMidiChunks(
  view: DataView,
  startOffset: number
): { trackChunks: RawMidiChunk[]; skippedChunks: RawMidiChunk[] } {
  const trackChunks: RawMidiChunk[] = [];
  const skippedChunks: RawMidiChunk[] = [];
  let offset = startOffset;

  while (offset + 8 <= view.byteLength) {
    const chunkType = readAsciiString(view, offset, 4);
    const declaredLength = view.getUint32(offset + 4, false);
    offset += 8;

    const remainingBytes = Math.max(0, view.byteLength - offset);
    const actualLength = Math.min(declaredLength, remainingBytes);

    const chunkDescriptor: RawMidiChunk = {
      type: chunkType,
      offset,
      declaredLength,
      actualLength,
    };

    if (chunkType === 'MTrk') {
      trackChunks.push(chunkDescriptor);
    } else {
      skippedChunks.push(chunkDescriptor);
    }

    offset += actualLength;
  }

  return { trackChunks, skippedChunks };
}

// ============================================================================
// 4. TRACK EVENT STREAM PARSER
// ============================================================================

/**
 * Decodes all sequential delta-time events within an MTrk chunk.
 * Enforces running status reset rules and zero-velocity Note-On normalization.
 */
export function parseTrackEvents(
  view: DataView,
  trackOffset: number,
  trackLength: number
): {
  events: RawMidiEvent[];
  totalTicks: number;
  reachedEndOfTrack: boolean;
  trackName?: string;
  instrumentName?: string;
  primaryChannel: number;
  primaryProgram: number;
  hasPercussion: boolean;
} {
  const trackEnd = trackOffset + trackLength;
  let cursor = trackOffset;
  let currentTick = 0;
  let runningStatus: number | null = null;
  let reachedEndOfTrack = false;

  let trackName: string | undefined;
  let instrumentName: string | undefined;
  let primaryChannel = 0;
  let primaryProgram = 0;
  let hasPercussion = false;

  const channelCounts = new Map<number, number>();
  const channelPrograms = new Map<number, number>();
  const events: RawMidiEvent[] = [];
  const textDecoder = new TextDecoder('utf-8', { fatal: false });

  while (cursor < trackEnd) {
    // 1. Decode Delta-Time (VLQ with 4-byte overflow protection)
    let delta = 0;
    let deltaBytes = 0;
    let deltaOverflow = false;

    while (cursor < trackEnd && deltaBytes < 4) {
      const b = view.getUint8(cursor++);
      deltaBytes++;
      delta = delta * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) {
        break;
      }
      if (deltaBytes === 4) {
        deltaOverflow = true;
      }
    }

    if (deltaOverflow) {
      throw new InvalidMidiError(
        'Variable-length quantity exceeds 4-byte limit (28-bit overflow)',
        cursor
      );
    }

    currentTick += delta;

    if (cursor >= trackEnd) break;

    // 2. Peek & Resolve Status Byte
    let statusByte = view.getUint8(cursor);
    if (statusByte < 0x80) {
      if (runningStatus === null) {
        throw new InvalidMidiError(
          'Data byte encountered without active running status',
          cursor
        );
      }
      statusByte = runningStatus;
    } else {
      cursor++;
    }

    // 3. Dispatch Event Type
    if (statusByte === 0xff) {
      // META EVENT: strictly cancels running status
      runningStatus = null;
      if (cursor >= trackEnd) break;

      const metaType = view.getUint8(cursor++);
      const lenVlq = readVariableLengthQuantity(view, cursor, trackEnd);
      cursor += lenVlq.bytesRead;

      const actualLen = Math.min(lenVlq.value, trackEnd - cursor);
      const payloadOffset = view.byteOffset + cursor;
      const payloadBytes = new Uint8Array(view.buffer, payloadOffset, actualLen);
      cursor += actualLen;

      if (metaType === 0x2f) {
        // End of Track
        reachedEndOfTrack = true;
        events.push({ type: 'endOfTrack', tick: currentTick });
        break;
      } else if (metaType === 0x51) {
        // Set Tempo
        if (actualLen >= 3) {
          const b0 = payloadBytes[0] ?? 0;
          const b1 = payloadBytes[1] ?? 0;
          const b2 = payloadBytes[2] ?? 0;
          const microsecondsPerQuarter = (b0 << 16) | (b1 << 8) | b2;
          const bpm =
            microsecondsPerQuarter > 0 ? 60_000_000 / microsecondsPerQuarter : 120;
          events.push({ type: 'setTempo', tick: currentTick, microsecondsPerQuarter, bpm });
        }
      } else if (metaType === 0x58) {
        // Time Signature
        if (actualLen >= 4) {
          const numerator = payloadBytes[0] ?? 4;
          const denExp = payloadBytes[1] ?? 2;
          const denominator = Math.pow(2, denExp);
          const clocksPerClick = payloadBytes[2] ?? 24;
          const thirtySecondsPerQuarter = payloadBytes[3] ?? 8;
          events.push({
            type: 'timeSignature',
            tick: currentTick,
            numerator,
            denominator,
            clocksPerClick,
            thirtySecondsPerQuarter,
          });
        }
      } else if (metaType === 0x59) {
        // Key Signature
        if (actualLen >= 2) {
          const rawKey = payloadBytes[0] ?? 0;
          const key = rawKey > 127 ? rawKey - 256 : rawKey;
          const scale = ((payloadBytes[1] ?? 0) === 0 ? 0 : 1) as 0 | 1;
          events.push({ type: 'keySignature', tick: currentTick, key, scale });
        }
      } else if (metaType === 0x03) {
        // Track Name
        const text = textDecoder.decode(payloadBytes).replace(/\0+$/, '').trim();
        if (text.length > 0 && !trackName) trackName = text;
        events.push({ type: 'trackName', tick: currentTick, text });
      } else if (metaType === 0x04) {
        // Instrument Name
        const text = textDecoder.decode(payloadBytes).replace(/\0+$/, '').trim();
        if (text.length > 0 && !instrumentName) instrumentName = text;
        events.push({ type: 'instrumentName', tick: currentTick, text });
      } else {
        // Other Meta Event
        events.push({ type: 'metaOther', tick: currentTick, metaType, data: payloadBytes });
      }
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      // SYSEX EVENT: cancels running status
      runningStatus = null;
      const lenVlq = readVariableLengthQuantity(view, cursor, trackEnd);
      cursor += lenVlq.bytesRead;

      const actualLen = Math.min(lenVlq.value, trackEnd - cursor);
      const payloadBytes = new Uint8Array(view.buffer, view.byteOffset + cursor, actualLen);
      cursor += actualLen;
      events.push({ type: 'sysEx', tick: currentTick, data: payloadBytes });
    } else if (statusByte >= 0x80 && statusByte <= 0xef) {
      // CHANNEL VOICE MESSAGE: establishes running status
      runningStatus = statusByte;
      const command = statusByte & 0xf0;
      const channel = statusByte & 0x0f;

      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
      if (channel === 9) hasPercussion = true;

      if (command === 0x80) {
        // Note Off
        if (cursor + 2 > trackEnd) break;
        const pitch = view.getUint8(cursor++);
        const velocity = view.getUint8(cursor++);
        events.push({ type: 'noteOff', tick: currentTick, channel, pitch, velocity });
      } else if (command === 0x90) {
        // Note On
        if (cursor + 2 > trackEnd) break;
        const pitch = view.getUint8(cursor++);
        const velocity = view.getUint8(cursor++);
        if (velocity === 0) {
          // Zero-Velocity Note-On Normalized to Note-Off
          events.push({ type: 'noteOff', tick: currentTick, channel, pitch, velocity: 0 });
        } else {
          events.push({ type: 'noteOn', tick: currentTick, channel, pitch, velocity });
        }
      } else if (command === 0xc0) {
        // Program Change
        if (cursor + 1 > trackEnd) break;
        const program = view.getUint8(cursor++);
        channelPrograms.set(channel, program);
        if (primaryProgram === 0) primaryProgram = program;
        events.push({ type: 'programChange', tick: currentTick, channel, program });
      } else if (command === 0xb0) {
        // Control Change
        if (cursor + 2 > trackEnd) break;
        const controller = view.getUint8(cursor++);
        const value = view.getUint8(cursor++);
        events.push({ type: 'controlChange', tick: currentTick, channel, controller, value });
      } else if (command === 0xe0) {
        // Pitch Bend
        if (cursor + 2 > trackEnd) break;
        const lsb = view.getUint8(cursor++);
        const msb = view.getUint8(cursor++);
        events.push({ type: 'pitchBend', tick: currentTick, channel, value: (msb << 7) | lsb });
      } else if (command === 0xa0) {
        // Polyphonic Key Pressure
        if (cursor + 2 > trackEnd) break;
        cursor += 2;
      } else if (command === 0xd0) {
        // Channel Pressure
        if (cursor + 1 > trackEnd) break;
        cursor += 1;
      }
    } else {
      // System Real-Time or Common (0xF1 - 0xFE)
      runningStatus = null;
      if (statusByte === 0xf1 || statusByte === 0xf3) cursor = Math.min(cursor + 1, trackEnd);
      else if (statusByte === 0xf2) cursor = Math.min(cursor + 2, trackEnd);
    }
  }

  // Determine dominant channel
  let maxCount = -1;
  for (const [ch, count] of channelCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      primaryChannel = ch;
    }
  }

  if (channelPrograms.has(primaryChannel)) {
    primaryProgram = channelPrograms.get(primaryChannel) ?? primaryProgram;
  }

  return {
    events,
    totalTicks: currentTick,
    reachedEndOfTrack,
    trackName,
    instrumentName,
    primaryChannel,
    primaryProgram,
    hasPercussion,
  };
}

// ============================================================================
// 5. DYNAMIC TEMPO MAP ENGINE
// ============================================================================

/**
 * High-performance piecewise-linear Dynamic Tempo Map.
 * Provides O(log K) binary search mapping between MIDI ticks and continuous physical seconds.
 */
export class TempoMap {
  public readonly entries: TempoChange[];
  public readonly points: TempoChange[];
  public readonly ppq: number;
  private readonly ticksArr: Int32Array;
  private readonly secondsArr: Float64Array;
  private readonly microsArr: Float64Array;
  private readonly ppqMillion: number;

  constructor(
    arg1: number | Array<{ tick: number; microsecondsPerQuarter: number }>,
    arg2?: Array<{ tick: number; microsecondsPerQuarter: number }> | number
  ) {
    let rawPpq: number;
    let rawTempoChanges: Array<{ tick: number; microsecondsPerQuarter: number }>;

    if (typeof arg1 === 'number') {
      rawPpq = arg1;
      rawTempoChanges = Array.isArray(arg2) ? arg2 : [];
    } else {
      rawTempoChanges = Array.isArray(arg1) ? arg1 : [];
      rawPpq = typeof arg2 === 'number' ? arg2 : DEFAULT_TICKS_PER_QUARTER;
    }

    this.ppq = rawPpq > 0 ? rawPpq : DEFAULT_TICKS_PER_QUARTER;
    this.ppqMillion = this.ppq * 1_000_000;

    // 1. Sort raw tempo events by tick ascending (stable sort preserves file order)
    const sorted = [...rawTempoChanges].sort((a, b) => a.tick - b.tick);

    // 2. Deduplicate events at identical ticks (last declared event wins)
    const deduped: Array<{ tick: number; microsecondsPerQuarter: number }> = [];
    for (const ev of sorted) {
      const safeMicros =
        ev.microsecondsPerQuarter > 0
          ? ev.microsecondsPerQuarter
          : DEFAULT_MICROSECONDS_PER_QUARTER;

      const last = deduped[deduped.length - 1];
      if (last && last.tick === ev.tick) {
        deduped[deduped.length - 1] = { tick: ev.tick, microsecondsPerQuarter: safeMicros };
      } else {
        deduped.push({ tick: ev.tick, microsecondsPerQuarter: safeMicros });
      }
    }

    // 3. Ensure default 120 BPM tempo exists at tick 0 if not explicitly defined
    const first = deduped[0];
    if (!first || first.tick > 0) {
      deduped.unshift({
        tick: 0,
        microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER,
      });
    }

    // 4. Precalculate cumulative elapsed physical seconds at each transition
    this.entries = [];
    let cumulativeSeconds = 0;

    for (let i = 0; i < deduped.length; i++) {
      const cur = deduped[i]!;
      if (i > 0) {
        const prev = deduped[i - 1]!;
        const deltaTicks = cur.tick - prev.tick;
        cumulativeSeconds += (deltaTicks * prev.microsecondsPerQuarter) / (this.ppq * 1_000_000);
      }

      const bpm = cur.microsecondsPerQuarter > 0 ? 60_000_000 / cur.microsecondsPerQuarter : 120;

      this.entries.push({
        tick: cur.tick,
        microsecondsPerQuarter: cur.microsecondsPerQuarter,
        bpm,
        seconds: cumulativeSeconds,
      });
    }

    this.points = this.entries;

    const len = this.entries.length;
    this.ticksArr = new Int32Array(len);
    this.secondsArr = new Float64Array(len);
    this.microsArr = new Float64Array(len);

    for (let i = 0; i < len; i++) {
      const e = this.entries[i]!;
      this.ticksArr[i] = e.tick;
      this.secondsArr[i] = e.seconds;
      this.microsArr[i] = e.microsecondsPerQuarter;
    }
  }

  /**
   * Returns all precalculated TempoChange entries.
   */
  public getEntries(): TempoChange[] {
    return this.entries;
  }

  /**
   * Converts an arbitrary MIDI tick offset into continuous physical seconds.
   * Execution complexity: O(log K) where K is number of tempo changes.
   */
  public tickToSeconds(tick: number): number {
    if (tick <= 0) return 0.0;

    const ticks = this.ticksArr;
    let low = 0;
    let high = ticks.length - 1;
    let k = 0;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (ticks[mid]! <= tick) {
        k = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const deltaTicks = tick - ticks[k]!;
    return this.secondsArr[k]! + (deltaTicks * this.microsArr[k]!) / this.ppqMillion;
  }

  /**
   * Converts continuous physical seconds back to integer MIDI tick offset.
   * Execution complexity: O(log K).
   */
  public secondsToTick(seconds: number): number {
    if (seconds <= 0) return 0;

    const secArr = this.secondsArr;
    let low = 0;
    let high = secArr.length - 1;
    let k = 0;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (secArr[mid]! <= seconds) {
        k = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const deltaSeconds = seconds - secArr[k]!;
    const deltaTicks = (deltaSeconds * this.ppqMillion) / this.microsArr[k]!;
    return Math.round(this.ticksArr[k]! + deltaTicks);
  }

  /**
   * Converts arbitrary MIDI tick to quantized Minecraft redstone tick (10 Hz).
   */
  public tickToRedstoneTick(tick: number): number {
    return Math.round(this.tickToSeconds(tick) * REDSTONE_TICKS_PER_SECOND);
  }

  /**
   * Retrieves active tempo transition entry at given tick.
   */
  public getTempoAtTick(tick: number): TempoChange {
    let low = 0;
    let high = this.entries.length - 1;
    let k = 0;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const entry = this.entries[mid];
      if (entry && entry.tick <= tick) {
        k = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return this.entries[k] ?? this.entries[0]!;
  }

  /**
   * Retrieves primary initial song BPM.
   */
  public getPrimaryBpm(): number {
    const first = this.entries[0];
    return first ? first.bpm : 120;
  }
}

/** DynamicTempoMap alias for compatibility */
export { TempoMap as DynamicTempoMap };

// ============================================================================
// 6. POLYPHONIC FIFO NOTE PAIRING ENGINE
// ============================================================================

interface PendingNoteRecord {
  pitch: number;
  velocity: number;
  startTick: number;
  channel: number;
  program: number;
}

/**
 * Pairs disjoint Note-On and Note-Off events into discrete MidiRawNote objects.
 * Accurately resolves polyphony, chords, overlapping note-ons, orphan note-offs,
 * and terminates unclosed notes at track end.
 */
export function pairTrackNotes(
  events: RawMidiEvent[],
  tempoMap: TempoMap,
  trackTotalTicks: number,
  fallbackProgram = 0
): MidiRawNote[] {
  const channelPrograms = new Array<number>(16).fill(fallbackProgram);
  // Key: (channel << 8) | pitch (11-bit composite integer)
  const pendingNotes = new Map<number, PendingNoteRecord[]>();
  const notes: MidiRawNote[] = [];

  for (const evt of events) {
    if (evt.type === 'programChange') {
      channelPrograms[evt.channel] = evt.program;
    } else if (evt.type === 'noteOn') {
      const key = (evt.channel << 8) | evt.pitch;
      let queue = pendingNotes.get(key);
      if (!queue) {
        queue = [];
        pendingNotes.set(key, queue);
      }
      queue.push({
        pitch: evt.pitch,
        velocity: Math.min(127, Math.max(1, evt.velocity)),
        startTick: evt.tick,
        channel: evt.channel,
        program: channelPrograms[evt.channel] ?? fallbackProgram,
      });
    } else if (evt.type === 'noteOff') {
      const key = (evt.channel << 8) | evt.pitch;
      const queue = pendingNotes.get(key);
      if (queue && queue.length > 0) {
        const on = queue.shift();
        if (on) {
          const durationTicks = Math.max(0, evt.tick - on.startTick);
          const startSeconds = tempoMap.tickToSeconds(on.startTick);
          const endSeconds = tempoMap.tickToSeconds(evt.tick);
          const durationSeconds = Math.max(0, endSeconds - startSeconds);

          notes.push({
            pitch: on.pitch,
            velocity: on.velocity,
            startTick: on.startTick,
            durationTicks,
            startSeconds,
            durationSeconds,
            channel: on.channel,
            program: on.program,
          });
        }
      }
    }
  }

  // Gracefully close any unterminated open notes at track end
  for (const queue of pendingNotes.values()) {
    while (queue.length > 0) {
      const on = queue.shift();
      if (!on) continue;

      const endTick = Math.max(on.startTick, trackTotalTicks);
      const durationTicks = Math.max(0, endTick - on.startTick);
      const startSeconds = tempoMap.tickToSeconds(on.startTick);
      const endSeconds = tempoMap.tickToSeconds(endTick);
      const durationSeconds = Math.max(0, endSeconds - startSeconds);

      notes.push({
        pitch: on.pitch,
        velocity: on.velocity,
        startTick: on.startTick,
        durationTicks,
        startSeconds,
        durationSeconds,
        channel: on.channel,
        program: on.program,
      });
    }
  }

  // Sort notes deterministically by startTick, pitch, channel
  return notes.sort((a, b) => {
    if (a.startTick !== b.startTick) return a.startTick - b.startTick;
    if (a.pitch !== b.pitch) return a.pitch - b.pitch;
    return a.channel - b.channel;
  });
}

// ============================================================================
// 7. HIGH-LEVEL PARSER ENTRY POINT
// ============================================================================

/**
 * Parses an SMF binary payload (ArrayBuffer or Uint8Array) into a complete MidiFile.
 */
export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFile {
  let u8: Uint8Array;
  if (input instanceof ArrayBuffer) {
    u8 = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new InvalidMidiError('Input must be an ArrayBuffer or Uint8Array view');
  }

  if (u8.byteLength < 14) {
    throw new InvalidMidiError('File is too short to contain a valid MIDI header', 0);
  }

  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let startOffset = 0;

  // Handle RIFF/RMID wrappers
  if (u8.byteLength >= 12 && readAsciiString(view, 0, 4) === 'RIFF') {
    const riffType = readAsciiString(view, 8, 4);
    if (riffType === 'RMID') {
      let rmidOffset = 12;
      while (rmidOffset + 8 <= u8.byteLength) {
        const subId = readAsciiString(view, rmidOffset, 4);
        const subLen = view.getUint32(rmidOffset + 4, false);
        if (subId === 'data') {
          startOffset = rmidOffset + 8;
          break;
        }
        rmidOffset += 8 + subLen;
      }
    }
  }

  const { header, nextOffset } = parseMidiHeader(view, startOffset);
  const { trackChunks } = scanMidiChunks(view, nextOffset);

  const rawTracksData: Array<ReturnType<typeof parseTrackEvents>> = [];
  const rawTempoEvents: Array<{ tick: number; microsecondsPerQuarter: number }> = [];
  const timeSignatures: TimeSignature[] = [];
  const keySignatures: KeySignature[] = [];

  for (const chunk of trackChunks) {
    const parsed = parseTrackEvents(view, chunk.offset, chunk.actualLength);
    rawTracksData.push(parsed);

    for (const evt of parsed.events) {
      if (evt.type === 'setTempo') {
        rawTempoEvents.push({
          tick: evt.tick,
          microsecondsPerQuarter: evt.microsecondsPerQuarter,
        });
      } else if (evt.type === 'timeSignature') {
        timeSignatures.push({
          tick: evt.tick,
          numerator: evt.numerator,
          denominator: evt.denominator,
          clocksPerClick: evt.clocksPerClick,
          thirtySecondsPerQuarter: evt.thirtySecondsPerQuarter,
        });
      } else if (evt.type === 'keySignature') {
        keySignatures.push({
          tick: evt.tick,
          key: evt.key,
          scale: evt.scale,
        });
      }
    }
  }

  const tempoMap = new TempoMap(header.ticksPerQuarterNote, rawTempoEvents);

  let songTotalTicks = 0;
  const tracks: MidiTrack[] = [];

  for (let i = 0; i < rawTracksData.length; i++) {
    const raw = rawTracksData[i];
    if (!raw) continue;

    const notes = pairTrackNotes(raw.events, tempoMap, raw.totalTicks, raw.primaryProgram);

    let trackMaxTicks = raw.totalTicks;
    for (const n of notes) {
      const noteEnd = n.startTick + n.durationTicks;
      if (noteEnd > trackMaxTicks) {
        trackMaxTicks = noteEnd;
      }
    }

    if (trackMaxTicks > songTotalTicks) {
      songTotalTicks = trackMaxTicks;
    }

    const defaultName =
      i === 0 && notes.length === 0 ? 'Tempo Track' : `Track ${i + 1}`;
    const name = raw.trackName && raw.trackName.length > 0 ? raw.trackName : defaultName;

    const isPercussion =
      raw.hasPercussion || raw.primaryChannel === 9 || notes.some((n) => n.channel === 9);

    tracks.push({
      id: i,
      name,
      channel: raw.primaryChannel,
      instrumentProgram: raw.primaryProgram,
      isPercussion,
      notes,
      totalTicks: trackMaxTicks,
    });
  }

  const durationSeconds = songTotalTicks > 0 ? tempoMap.tickToSeconds(songTotalTicks) : 0;

  return {
    format: header.format,
    numTracks: tracks.length,
    ticksPerQuarterNote: header.ticksPerQuarterNote,
    tracks,
    tempoMap: tempoMap.getEntries(),
    timeSignatures: timeSignatures.sort((a, b) => a.tick - b.tick),
    keySignatures: keySignatures.sort((a, b) => a.tick - b.tick),
    durationSeconds,
    totalTicks: songTotalTicks,
  };
}
