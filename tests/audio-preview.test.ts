import { describe, it, expect } from 'vitest';
import { WebAudioNoteBlockPlayer } from '../src/core/audio-preview';
import type { SongTimeline } from '../src/core/types';

describe('WebAudioNoteBlockPlayer Unit Test', () => {
  it('instantiates, loads song, and updates transport state cleanly in node environment', async () => {
    const player = new WebAudioNoteBlockPlayer();
    expect(player).toBeDefined();

    const mockSong: SongTimeline = {
      title: 'Mock Song',
      totalRedstoneTicks: 10,
      durationSeconds: 1.0,
      bpm: 120,
      eventsByTick: new Map(),
      allEvents: [],
      tracks: [{ id: 0, name: 'Harp', instrument: 'harp', noteCount: 1, isPercussion: false }],
    };

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
});
