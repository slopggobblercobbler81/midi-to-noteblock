/**
 * src/core/audio-preview.ts
 *
 * In-Browser Web Audio Preview Synthesizer & Transport Engine.
 * Simulates vanilla Minecraft note block timbres across all 16 instruments
 * using accurate physical synthesis (oscillators, noise buffers, and filter envelopes)
 * synchronized with high-precision AudioContext scheduling.
 *
 * Runs 100% client-side with zero external audio assets.
 */

import {
  type SongTimeline,
  type AudioPlayer,
  type AudioPlayerState,
  type PlaybackMode,
  type NoteBlockEvent,
  calculateNoteBlockPitchMultiplier,
  REDSTONE_TICKS_PER_SECOND,
} from './types';

// Standard F#4 frequency (pitch = 12)
const BASE_F_SHARP_4 = 369.994;

export class WebAudioNoteBlockPlayer implements AudioPlayer {
  private ctx: AudioContext | null = null;
  private song: SongTimeline | null = null;
  private state: AudioPlayerState = {
    status: 'stopped',
    isPlaying: false,
    isPaused: false,
    currentTime: 0,
    duration: 0,
    currentRedstoneTick: 0,
    volume: 0.8,
    playbackSpeed: 1.0,
    mode: 'synth',
    mutedTracks: new Set<number>(),
    soloTracks: new Set<number>(),
  };

  private masterGain: GainNode | null = null;
  private scheduledEvents: number[] = [];
  private playbackStartTime = 0;
  private pauseOffset = 0;
  private tickInterval: any = null;
  private tickCallbacks = new Set<(state: AudioPlayerState) => void>();
  private endedCallbacks = new Set<() => void>();
  private noiseBuffer: AudioBuffer | null = null;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext(): void {
    if (typeof window === 'undefined') return;
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass && !this.ctx) {
      try {
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.state.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.createNoiseBuffer();
      } catch {
        // AudioContext restricted before user interaction
      }
    }
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 1.5;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
  }

  private ensureRunning(): void {
    if (!this.ctx) this.initAudioContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public async loadSong(song: SongTimeline): Promise<void> {
    this.stop();
    this.song = song;
    this.state.duration = song.durationSeconds;
    this.state.currentTime = 0;
    this.state.currentRedstoneTick = 0;
    this.pauseOffset = 0;
    this.notifyTick();
  }

  public async play(): Promise<void> {
    if (!this.song || this.song.allEvents.length === 0) return;
    this.ensureRunning();

    if (this.state.status === 'playing') return;

    this.state.status = 'playing';
    this.state.isPlaying = true;
    this.state.isPaused = false;

    if (this.ctx) {
      this.playbackStartTime = this.ctx.currentTime - (this.pauseOffset / this.state.playbackSpeed);
      this.schedulePlaybackFrom(this.pauseOffset);
    }

    this.startTickTimer();
    this.notifyTick();
  }

  public pause(): void {
    if (this.state.status !== 'playing') return;

    this.state.status = 'paused';
    this.state.isPlaying = false;
    this.state.isPaused = true;

    if (this.ctx) {
      this.pauseOffset = Math.max(
        0,
        (this.ctx.currentTime - this.playbackStartTime) * this.state.playbackSpeed
      );
    }

    this.cancelScheduledEvents();
    this.stopTickTimer();
    this.notifyTick();
  }

  public stop(): void {
    this.state.status = 'stopped';
    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.currentTime = 0;
    this.state.currentRedstoneTick = 0;
    this.pauseOffset = 0;

    this.cancelScheduledEvents();
    this.stopTickTimer();
    this.notifyTick();
  }

  public seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(this.state.duration, seconds));
    const wasPlaying = this.state.isPlaying;

    if (wasPlaying) {
      this.cancelScheduledEvents();
    }

    this.pauseOffset = clamped;
    this.state.currentTime = clamped;
    this.state.currentRedstoneTick = Math.round(clamped * REDSTONE_TICKS_PER_SECOND);

    if (this.ctx) {
      this.playbackStartTime = this.ctx.currentTime - (clamped / this.state.playbackSpeed);
    }

    if (wasPlaying) {
      this.schedulePlaybackFrom(clamped);
    }

    this.notifyTick();
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1.0, volume));
    this.state.volume = clamped;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(clamped, this.ctx.currentTime);
    }
  }

  public setSpeed(speed: number): void {
    const clamped = Math.max(0.25, Math.min(3.0, speed));
    const wasPlaying = this.state.isPlaying;
    if (wasPlaying) {
      this.pause();
      this.state.playbackSpeed = clamped;
      this.play();
    } else {
      this.state.playbackSpeed = clamped;
    }
  }

  public setTrackMute(trackId: number, muted: boolean): void {
    if (muted) {
      this.state.mutedTracks.add(trackId);
    } else {
      this.state.mutedTracks.delete(trackId);
    }
  }

  public setTrackSolo(trackId: number, soloed: boolean): void {
    if (soloed) {
      this.state.soloTracks.add(trackId);
    } else {
      this.state.soloTracks.delete(trackId);
    }
  }

  public setPlaybackMode(mode: PlaybackMode): void {
    this.state.mode = mode;
  }

  public getState(): AudioPlayerState {
    return {
      ...this.state,
      mutedTracks: new Set(this.state.mutedTracks),
      soloTracks: new Set(this.state.soloTracks),
    };
  }

  public onTick(callback: (state: AudioPlayerState) => void): () => void {
    this.tickCallbacks.add(callback);
    return () => this.tickCallbacks.delete(callback);
  }

  public onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback);
    return () => this.endedCallbacks.delete(callback);
  }

  public dispose(): void {
    this.stop();
    this.tickCallbacks.clear();
    this.endedCallbacks.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private cancelScheduledEvents(): void {
    for (const timerId of this.scheduledEvents) {
      window.clearTimeout(timerId);
    }
    this.scheduledEvents = [];
  }

  private schedulePlaybackFrom(fromSeconds: number): void {
    if (!this.song || !this.ctx) return;

    const events = this.song.allEvents;
    const now = this.ctx.currentTime;
    const speed = this.state.playbackSpeed;

    for (const ev of events) {
      if (ev.timestampSeconds < fromSeconds) continue;

      const deltaSongSeconds = ev.timestampSeconds - fromSeconds;
      const delayAudioSeconds = deltaSongSeconds / speed;
      const scheduledTime = now + delayAudioSeconds;

      // Play audio on schedule
      this.triggerInstrumentSound(ev, scheduledTime);
    }

    // Schedule song end
    const remainingSongSeconds = Math.max(0, this.state.duration - fromSeconds);
    const endTimerId = window.setTimeout(() => {
      if (this.state.isPlaying) {
        this.stop();
        for (const cb of this.endedCallbacks) cb();
      }
    }, (remainingSongSeconds / speed) * 1000 + 100);

    this.scheduledEvents.push(endTimerId);
  }

  private triggerInstrumentSound(ev: NoteBlockEvent, time: number): void {
    if (!this.ctx || !this.masterGain) return;

    // Check mute / solo filters
    const hasSolo = this.state.soloTracks.size > 0;
    if (hasSolo && !this.state.soloTracks.has(ev.trackId)) return;
    if (!hasSolo && this.state.mutedTracks.has(ev.trackId)) return;

    const rateMultiplier = calculateNoteBlockPitchMultiplier(ev.note);
    const fundamentalFreq = BASE_F_SHARP_4 * rateMultiplier;
    const volume = Math.max(0.05, Math.min(1.0, ev.velocity));

    switch (ev.instrument) {
      case 'basedrum':
        this.synthKick(time, volume);
        break;
      case 'snare':
        this.synthSnare(time, volume);
        break;
      case 'hat':
        this.synthHat(time, volume);
        break;
      case 'bass':
        this.synthBass(time, fundamentalFreq / 4, volume);
        break;
      case 'flute':
        this.synthFlute(time, fundamentalFreq * 2, volume);
        break;
      case 'bell':
      case 'chime':
        this.synthBell(time, fundamentalFreq * 2, volume);
        break;
      case 'guitar':
        this.synthPluck(time, fundamentalFreq / 2, 'sawtooth', volume);
        break;
      case 'xylophone':
      case 'iron_xylophone':
        this.synthXylophone(time, fundamentalFreq, volume);
        break;
      case 'cow_bell':
        this.synthCowbell(time, fundamentalFreq, volume);
        break;
      case 'bit':
        this.synthChiptune(time, fundamentalFreq, volume);
        break;
      case 'banjo':
        this.synthPluck(time, fundamentalFreq, 'square', volume);
        break;
      case 'didgeridoo':
        this.synthDidgeridoo(time, fundamentalFreq / 4, volume);
        break;
      case 'pling':
      case 'harp':
      default:
        this.synthHarp(time, fundamentalFreq, volume);
        break;
    }
  }

  // --- Physical Synthesis Helpers ---

  private synthHarp(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, time);

    gain.gain.setValueAtTime(vol * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + 0.65);
    osc2.stop(time + 0.65);
  }

  private synthBass(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(vol * 0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.55);
  }

  private synthKick(time: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.08);

    gain.gain.setValueAtTime(vol * 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.16);
  }

  private synthSnare(time: number, vol: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.14);
  }

  private synthHat(time: number, vol: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  private synthFlute(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol * 0.35, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.52);
  }

  private synthBell(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, time);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.76, time); // Inharmonic metallic ratio

    gain.gain.setValueAtTime(vol * 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.8);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.85);
    osc2.stop(time + 0.85);
  }

  private synthPluck(time: number, freq: number, type: OscillatorType, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, time);
    filter.frequency.exponentialRampToValueAtTime(300, time + 0.3);

    gain.gain.setValueAtTime(vol * 0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.5);
  }

  private synthXylophone(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(vol * 0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.28);
  }

  private synthCowbell(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'square';
    osc1.frequency.setValueAtTime(freq * 0.9, time);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 1.4, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, time);

    gain.gain.setValueAtTime(vol * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.32);
    osc2.stop(time + 0.32);
  }

  private synthChiptune(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(vol * 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.32);
  }

  private synthDidgeridoo(time: number, freq: number, vol: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, time);
    filter.Q.setValueAtTime(4, time);

    gain.gain.setValueAtTime(vol * 0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.55);
  }

  // --- Transport Tick Loop ---

  private startTickTimer(): void {
    this.stopTickTimer();
    this.tickInterval = setInterval(() => {
      if (!this.state.isPlaying || !this.ctx) return;
      const elapsed = Math.max(
        0,
        (this.ctx.currentTime - this.playbackStartTime) * this.state.playbackSpeed
      );
      this.state.currentTime = Math.min(this.state.duration, elapsed);
      this.state.currentRedstoneTick = Math.round(
        this.state.currentTime * REDSTONE_TICKS_PER_SECOND
      );
      this.notifyTick();
    }, 50);
  }

  private stopTickTimer(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private notifyTick(): void {
    const currentState = this.getState();
    for (const cb of this.tickCallbacks) {
      cb(currentState);
    }
  }
}
