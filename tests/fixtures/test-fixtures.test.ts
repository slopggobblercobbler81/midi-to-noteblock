/**
 * tests/fixtures/test-fixtures.test.ts
 *
 * Unit tests validating the test infrastructure itself:
 * - Synthetic MIDI binary generator (SMF 0 & 1, VLQ, chunks)
 * - NBT binary reader & Litematica 64-bit bit-packing unpacked roundtrip
 */

import { describe, it, expect } from 'vitest';
import {
  encodeVLQ,
  generateMidiBinary,
  createMonophonicFormat0,
  createPolyphonicFormat1,
  createPercussionMidi,
  createAdversarialMidi,
} from './midi-generator';
import { unpackLitematicaBlockStates } from './nbt-reader';

describe('Test Infrastructure: MIDI Generator Fixtures', () => {
  it('correctly encodes Variable-Length Quantities (VLQ) according to MIDI 1.0 spec', () => {
    // 0 -> [0x00]
    expect(encodeVLQ(0)).toEqual([0x00]);
    // 127 -> [0x7F]
    expect(encodeVLQ(127)).toEqual([0x7f]);
    // 128 -> [0x81, 0x00]
    expect(encodeVLQ(128)).toEqual([0x81, 0x00]);
    // 480 (standard quarter note) -> [0x83, 0x60] (3*128 + 96 = 480)
    expect(encodeVLQ(480)).toEqual([0x83, 0x60]);
    // 16383 -> [0xFF, 0x7F]
    expect(encodeVLQ(16383)).toEqual([0xff, 0x7f]);
    // 16384 -> [0x81, 0x80, 0x00]
    expect(encodeVLQ(16384)).toEqual([0x81, 0x80, 0x00]);
  });

  it('generates valid SMF header chunk with MThd signature and big-endian metadata', () => {
    const midi = generateMidiBinary({
      format: 0,
      ticksPerQuarterNote: 480,
      tracks: [{ notes: [{ pitch: 60, startTick: 0, durationTicks: 480 }] }],
    });

    expect(midi.byteLength).toBeGreaterThan(14);
    // Magic 'MThd'
    expect(String.fromCharCode(midi[0]!, midi[1]!, midi[2]!, midi[3]!)).toBe('MThd');

    const view = new DataView(midi.buffer, midi.byteOffset, midi.byteLength);
    // Header length: 6
    expect(view.getUint32(4, false)).toBe(6);
    // Format: 0
    expect(view.getUint16(8, false)).toBe(0);
    // Track count: 1
    expect(view.getUint16(10, false)).toBe(1);
    // Time division (PPQ): 480
    expect(view.getUint16(12, false)).toBe(480);
    // First track magic 'MTrk' at offset 14
    expect(String.fromCharCode(midi[14]!, midi[15]!, midi[16]!, midi[17]!)).toBe('MTrk');
  });

  it('generates non-empty preset fixtures across Format 0, Format 1, Percussion, and Adversarial', () => {
    const mono0 = createMonophonicFormat0();
    const poly1 = createPolyphonicFormat1();
    const perc = createPercussionMidi();
    const adv = createAdversarialMidi();

    expect(mono0.length).toBeGreaterThan(30);
    expect(poly1.length).toBeGreaterThan(100);
    expect(perc.length).toBeGreaterThan(50);
    expect(adv.length).toBeGreaterThan(50);

    // Assert Format 1 has format=1 and numTracks > 1
    const viewPoly = new DataView(poly1.buffer, poly1.byteOffset, poly1.byteLength);
    expect(viewPoly.getUint16(8, false)).toBe(1);
    expect(viewPoly.getUint16(10, false)).toBe(4); // 4 tracks
  });
});

describe('Test Infrastructure: Litematica 64-bit Bitstream Unpacker', () => {
  it('correctly unpacks bit-packed palette indices straddling 64-bit Long boundaries', () => {
    // Test packing and unpacking for bitsPerBlock = 3 (8 palette items)
    // 64 bits holds 21 items (21 * 3 = 63 bits), with item 21 straddling bit 63 of long 0 and bits 0-1 of long 1
    const bitsPerBlock = 3;
    const testIndices = [
      0, 1, 2, 3, 4, 5, 6, 7, // 8
      1, 2, 3, 4, 5, 6, 7, 0, // 16
      2, 3, 4, 5, 6,          // 21 items in first long (63 bits used)
      7,                      // Item 21 (straddles: 1 bit in long 0, 2 bits in long 1)
      3, 4, 5                 // Items in second long
    ];
    const volume = testIndices.length;

    // Manually pack according to Litematica continuous bitstream spec
    const totalBits = BigInt(volume) * BigInt(bitsPerBlock);
    const numLongs = Number((totalBits + 63n) / 64n);
    const packedLongs = new BigInt64Array(numLongs);
    const mask = (1n << BigInt(bitsPerBlock)) - 1n;

    for (let i = 0; i < volume; i++) {
      const val = BigInt(testIndices[i]!) & mask;
      const startBit = BigInt(i) * BigInt(bitsPerBlock);
      const longIdx = Number(startBit / 64n);
      const bitOffset = Number(startBit % 64n);

      if (bitOffset + bitsPerBlock <= 64) {
        packedLongs[longIdx] = BigInt.asIntN(64, packedLongs[longIdx]! | (val << BigInt(bitOffset)));
      } else {
        const lowerBitsCount = 64 - bitOffset;
        const lowerVal = val & ((1n << BigInt(lowerBitsCount)) - 1n);
        packedLongs[longIdx] = BigInt.asIntN(64, packedLongs[longIdx]! | (lowerVal << BigInt(bitOffset)));

        const upperVal = val >> BigInt(lowerBitsCount);
        packedLongs[longIdx + 1] = BigInt.asIntN(64, packedLongs[longIdx + 1]! | upperVal);
      }
    }

    // Now test unpacker oracle
    const unpacked = unpackLitematicaBlockStates(packedLongs, bitsPerBlock, volume);
    expect(unpacked).toEqual(testIndices);
  });
});
