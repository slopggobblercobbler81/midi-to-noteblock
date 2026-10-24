import { describe, it, expect, vi } from 'vitest';
import { WebAudioNoteBlockPlayer } from '../src/core/audio-preview';
import type { SongTimeline, NoteBlockEvent } from '../src/core/types';

describe('WebAudioNoteBlockPlayer Unit Test', () => {
  const sampleEvent: NoteBlockEvent = {
    redstoneTick: 1,
    timestampSeconds: 0.1,
    instrument: 'harp',
    baseBlock: 'minecraft:dirt',
    note: 12,
    velocity: 0.8,
    trackId: 0,
    channel: 0,
  };

  const mockSong: SongTimeline = {
    title: 'Mock Song',
    totalRedstoneTicks: 10,
    durationSeconds: 1.0,
    bpm: 120,
    eventsByTick: new Map([[1, [sampleEvent]]]),
    allEvents: [sampleEvent],
    tracks: [{ id: 0, name: 'Harp', instrument: 'harp', noteCount: 1, isPercussion: false }],
  };

  it('instantiates, loads song, and updates transport state cleanly in node environment', async () => {
    const player = new WebAudioNoteBlockPlayer();
    expect(player).toBeDefined();

    await player.loadSong(mockSong);
    const state = player.getState();
    expect(state.duration).toBe(1.0);
    expect(state.status).toBe('stopped');

    player.setVolume(0.5);
    expect(player.getState().volume).toBe(0.5);

    player.setSpeed(1.5);
    expect(player.getState().playbackSpeed).toBe(1.5);

    player.setTrackMute(0, true);
    expect(player.getState().mutedTracks.has(0)).toBe(true);

    player.seek(0.5);
    expect(player.getState().currentTime).toBe(0.5);

    player.dispose();
  });

  it('handles play, pause, resume, and stop transitions without errors', async () => {
    const player = new WebAudioNoteBlockPlayer();
    await player.loadSong(mockSong);

    await player.play();
    expect(player.getState().status).toBe('playing');
    expect(player.getState().isPlaying).toBe(true);
    expect(player.getState().isPaused).toBe(false);

    player.pause();
    expect(player.getState().status).toBe('paused');
    expect(player.getState().isPlaying).toBe(false);
    expect(player.getState().isPaused).toBe(true);

    await player.play();
    expect(player.getState().status).toBe('playing');
    expect(player.getState().isPlaying).toBe(true);

    player.stop();
    expect(player.getState().status).toBe('stopped');
    expect(player.getState().isPlaying).toBe(false);
    expect(player.getState().isPaused).toBe(false);
    expect(player.getState().currentTime).toBe(0);

    player.dispose();
  });

  it('correctly tracks and stops active WebAudio nodes on pause', async () => {
    // Mock AudioContext and nodes in global environment for this test
    const immediateStopCalls: any[] = [];
    const scheduledStopCalls: any[] = [];
    const disconnectedNodes: any[] = [];

    function MockOscillator(this: any) {
      this.type = 'sine';
      this.frequency = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
      this.connect = vi.fn();
      this.start = vi.fn();
      this.stop = vi.fn((when?: number) => {
        if (when === undefined) {
          immediateStopCalls.push(this);
        } else {
          scheduledStopCalls.push({ node: this, when });
        }
      });
      this.disconnect = vi.fn(() => {
        disconnectedNodes.push(this);
      });
      this.onended = null;
    }

    function MockGain(this: any) {
      this.gain = {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      };
      this.connect = vi.fn();
      this.disconnect = vi.fn();
    }

    const mockCtx = {
      currentTime: 0,
      sampleRate: 44100,
      state: 'running',
      createOscillator: () => new (MockOscillator as any)(),
      createGain: () => new (MockGain as any)(),
      createBufferSource: () => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      createBuffer: () => ({
        getChannelData: () => new Float32Array(100),
      }),
      destination: {},
      resume: vi.fn().mockImplementation(async () => {
        mockCtx.state = 'running';
      }),
      suspend: vi.fn().mockImplementation(async () => {
        mockCtx.state = 'suspended';
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    function MockAudioContext(this: any) {
      return mockCtx;
    }

    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    };

    const player = new WebAudioNoteBlockPlayer();
    await player.loadSong(mockSong);

    await player.play();

    // Notes should have been scheduled into the future
    expect(scheduledStopCalls.length).toBeGreaterThan(0);
    expect(immediateStopCalls.length).toBe(0);

    // Now pause: should silence master gain, suspend context, and immediately stop & disconnect active oscillators
    player.pause();
    expect(mockCtx.suspend).toHaveBeenCalled();
    expect(immediateStopCalls.length).toBeGreaterThan(0);
    expect(disconnectedNodes.length).toBeGreaterThan(0);

    // Resuming from pause should resume context
    await player.play();
    expect(mockCtx.resume).toHaveBeenCalled();

    player.dispose();
    delete (globalThis as any).window;
  });
});
