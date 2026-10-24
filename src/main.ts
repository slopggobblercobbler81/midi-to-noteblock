/**
 * src/main.ts
 *
 * Full-featured Web Application Client for MIDI to Minecraft Note Block Converter.
 * Provides interactive file drag & drop, audio preview transport, live piano roll visualizer,
 * track-level instrument inspector, and one-click Sponge (.schem) & Litematica (.litematic) downloads.
 */

import './style.css';
import { parseMidi } from './core/midi-parser';
import { convertToSongTimeline } from './core/noteblock-mapper';
import { exportSpongeSchematic } from './core/schem-exporter';
import { exportLitematic } from './core/litematic-exporter';
import { WebAudioNoteBlockPlayer } from './core/audio-preview';
import {
  MINECRAFT_INSTRUMENTS,
  type MidiFile,
  type SongTimeline,
  type ConversionOptions,
  type MinecraftInstrument,
  type AudioPlayerState,
} from './core/types';

export const APP_TITLE = 'MIDI to Minecraft Note Block Converter';
export const APP_VERSION = '1.0.0';

// Global Application State
let currentMidi: MidiFile | null = null;
let currentTimeline: SongTimeline | null = null;
const audioPlayer = new WebAudioNoteBlockPlayer();

const conversionOptions: ConversionOptions = {
  manualTranspose: 0,
  preserveKey: false,
  enableOctaveFolding: true,
  instrumentOverrides: {},
};
let maxTrackWidth = 16;

/**
 * Downloads a binary Uint8Array buffer as a file in the user's browser.
 */
function triggerBrowserDownload(filename: string, mimeType: string, data: Uint8Array): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formats duration in seconds to MM:SS string.
 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Processes a raw MIDI binary buffer, recalculates timeline, and reloads audio player.
 */
export async function loadMidiBuffer(buffer: ArrayBuffer | Uint8Array, fileName = 'song.mid'): Promise<void> {
  try {
    currentMidi = parseMidi(buffer);
    if (!currentMidi.tracks.some((t) => t.name) && fileName) {
      currentMidi.tracks[0]!.name = fileName.replace(/\.[^/.]+$/, '');
    }

    conversionOptions.instrumentOverrides = {};
    recomputeTimeline();
    renderApp();
  } catch (err) {
    alert(`Failed to parse MIDI file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function recomputeTimeline(): void {
  if (!currentMidi) return;
  currentTimeline = convertToSongTimeline(currentMidi, conversionOptions);
  audioPlayer.loadSong(currentTimeline);
}

/**
 * Loads the bundled demo MIDI song.
 */
async function loadDemoSong(): Promise<void> {
  try {
    const res = await fetch('./demo.mid');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await loadMidiBuffer(buf, 'Takeshi abo - Lease.mid');
  } catch (err) {
    alert(`Could not load demo MIDI: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Renders the Visualizer / Piano Roll Canvas.
 */
function setupVisualizer(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const render = () => {
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw background grid lines
    ctx.strokeStyle = '#1e242c';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!currentTimeline || currentTimeline.allEvents.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Load a MIDI file to preview notes', width / 2, height / 2);
      requestAnimationFrame(render);
      return;
    }

    const playerState = audioPlayer.getState();
    const playheadTime = playerState.currentTime;

    // Window around current time: 6 seconds total
    const windowSeconds = 6;
    const startTime = Math.max(0, playheadTime - 1.0);
    const endTime = startTime + windowSeconds;

    // Draw notes
    for (const ev of currentTimeline.allEvents) {
      if (ev.timestampSeconds < startTime || ev.timestampSeconds > endTime) continue;

      const x = ((ev.timestampSeconds - startTime) / windowSeconds) * width;
      // Invert Y: higher note index -> higher up
      const y = height - (ev.note / 24) * (height - 16) - 8;

      const isCurrent = Math.abs(ev.timestampSeconds - playheadTime) < 0.12;
      ctx.fillStyle = isCurrent ? '#22c55e' : '#3b82f6';
      ctx.shadowColor = isCurrent ? '#22c55e' : 'transparent';
      ctx.shadowBlur = isCurrent ? 8 : 0;

      ctx.beginPath();
      ctx.arc(x, y, isCurrent ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw Playhead cursor
    const cursorX = ((playheadTime - startTime) / windowSeconds) * width;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();

    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
}

/**
 * Main application DOM renderer.
 */
export function renderApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const hasSong = currentTimeline !== null;
  const state = audioPlayer.getState();

  app.innerHTML = `
    <main class="app-container">
      <header>
        <div class="logo-badge">🎵 Minecraft Redstone Audio Converter</div>
        <h1>${APP_TITLE}</h1>
        <p class="tagline">Convert any MIDI file into playable Minecraft note block circuits (.schem & .litematic) with in-browser audio preview.</p>
      </header>

      <!-- 1. Upload & Demo Section -->
      <section class="card">
        <div class="card-title">
          <span>1. Select or Upload MIDI</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Standard .mid / .midi</span>
        </div>

        <div id="dropzone" class="dropzone">
          <div class="dropzone-icon">🎹</div>
          <div class="dropzone-text">Drag & drop your MIDI file here</div>
          <div class="dropzone-subtext">or click to browse files from your computer</div>
          <input type="file" id="fileInput" accept=".mid,.midi" style="display: none;" />
        </div>

        <div class="upload-actions">
          <button id="btnBrowse" class="btn btn-secondary">📁 Browse File</button>
          <button id="btnDemo" class="btn btn-primary">⚡ Load Demo Song (Takeshi Abo - Lease)</button>
        </div>
      </section>

      ${hasSong ? `
        <!-- 2. Audio Preview Player -->
        <section class="card">
          <div class="card-title">
            <span>2. In-Browser Minecraft Note Block Audio Preview</span>
            <span style="font-size: 0.85rem; color: var(--accent-green);">16 Vanilla Instruments Synthesizer</span>
          </div>

          <div class="player-container">
            <div class="visualizer-container">
              <canvas id="visualizer" width="900" height="140"></canvas>
            </div>

            <div class="transport-bar">
              <div class="transport-controls">
                <button id="btnPlayPause" class="btn ${state.isPlaying ? 'btn-secondary' : 'btn-primary'}">
                  ${state.isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button id="btnStop" class="btn btn-secondary">⏹ Stop</button>
              </div>

              <input
                type="range"
                id="seekSlider"
                class="seek-slider"
                min="0"
                max="${currentTimeline!.durationSeconds}"
                step="0.05"
                value="${state.currentTime}"
              />

              <div class="time-display" id="timeDisplay">
                ${formatTime(state.currentTime)} / ${formatTime(currentTimeline!.durationSeconds)}
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Tick: ${state.currentRedstoneTick} / ${currentTimeline!.totalRedstoneTicks}</span>
              </div>

              <div class="speed-container">
                <span>Speed:</span>
                <select id="speedSelect" class="inst-select">
                  <option value="0.5" ${state.playbackSpeed === 0.5 ? 'selected' : ''}>0.5x</option>
                  <option value="0.75" ${state.playbackSpeed === 0.75 ? 'selected' : ''}>0.75x</option>
                  <option value="1.0" ${state.playbackSpeed === 1.0 ? 'selected' : ''}>1.0x (Normal)</option>
                  <option value="1.25" ${state.playbackSpeed === 1.25 ? 'selected' : ''}>1.25x</option>
                  <option value="1.5" ${state.playbackSpeed === 1.5 ? 'selected' : ''}>1.5x</option>
                  <option value="2.0" ${state.playbackSpeed === 2.0 ? 'selected' : ''}>2.0x</option>
                </select>
              </div>

              <div class="volume-container">
                <span>Vol:</span>
                <input
                  type="range"
                  id="volumeSlider"
                  class="volume-slider"
                  min="0"
                  max="1"
                  step="0.05"
                  value="${state.volume}"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- 3. Conversion Settings & Track Inspector -->
        <section class="card">
          <div class="card-title">
            <span>3. Tuning & Conversion Settings</span>
            <span style="font-size: 0.85rem; color: var(--text-muted);">${currentTimeline!.tracks.length} Tracks Detected</span>
          </div>

          <div class="settings-grid">
            <div class="setting-item">
              <label class="setting-label">Transposition (Semitones)</label>
              <input
                type="number"
                id="transposeInput"
                class="setting-input"
                min="-24"
                max="24"
                value="${conversionOptions.manualTranspose ?? 0}"
              />
            </div>

            <div class="setting-item">
              <label class="setting-label">Max Circuit Width (Blocks)</label>
              <input
                type="number"
                id="widthInput"
                class="setting-input"
                min="5"
                max="32"
                value="${maxTrackWidth}"
              />
            </div>

            <div class="setting-item">
              <label class="setting-checkbox">
                <input
                  type="checkbox"
                  id="preserveKeyCheck"
                  ${conversionOptions.preserveKey ? 'checked' : ''}
                />
                <span>Preserve Musical Key (Octaves Only)</span>
              </label>

              <label class="setting-checkbox">
                <input
                  type="checkbox"
                  id="octaveFoldCheck"
                  ${conversionOptions.enableOctaveFolding !== false ? 'checked' : ''}
                />
                <span>Enable Octave Folding into [0, 24]</span>
              </label>
            </div>
          </div>

          <h4 style="margin-top: 1rem; font-size: 0.95rem;">Track Instruments & Mute/Solo:</h4>
          <div class="track-list">
            ${currentTimeline!.tracks.map((track) => `
              <div class="track-row" data-track-id="${track.id}">
                <div class="track-info">
                  <span class="track-name">${track.name}</span>
                  <span class="track-badge">${track.noteCount} notes</span>
                  ${track.isPercussion ? '<span class="track-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">Percussion</span>' : ''}
                </div>

                <div class="track-actions">
                  <select class="inst-select track-inst-select" data-track-id="${track.id}">
                    ${MINECRAFT_INSTRUMENTS.map((inst) => `
                      <option value="${inst}" ${track.instrument === inst ? 'selected' : ''}>${inst}</option>
                    `).join('')}
                  </select>

                  <button
                    class="btn-toggle track-mute ${state.mutedTracks.has(track.id) ? 'active-mute' : ''}"
                    data-track-id="${track.id}"
                    title="Mute Track"
                  >M</button>

                  <button
                    class="btn-toggle track-solo ${state.soloTracks.has(track.id) ? 'active-solo' : ''}"
                    data-track-id="${track.id}"
                    title="Solo Track"
                  >S</button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- 4. Schematic Export & Statistics -->
        <section class="card">
          <div class="card-title">
            <span>4. Schematic Export & Circuit Statistics</span>
            <span style="font-size: 0.85rem; color: var(--accent-green);">Ready to Export</span>
          </div>

          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-val">${currentTimeline!.allEvents.length}</div>
              <div class="stat-label">Note Blocks</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">${currentTimeline!.totalRedstoneTicks}</div>
              <div class="stat-label">Redstone Ticks</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">${currentTimeline!.bpm.toFixed(0)}</div>
              <div class="stat-label">BPM</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">${formatTime(currentTimeline!.durationSeconds)}</div>
              <div class="stat-label">Duration</div>
            </div>
          </div>

          <div class="export-buttons">
            <button id="btnExportSchem" class="btn btn-primary export-btn">
              📦 Download .schem (WorldEdit / Sponge 1.13+)
            </button>
            <button id="btnExportLitematic" class="btn btn-accent-blue export-btn">
              📜 Download .litematic (Litematica 1.12 - 1.20+)
            </button>
          </div>

          <div class="instructions-panel" style="margin-top: 1rem;">
            <h4>How to load into Minecraft:</h4>
            <ul>
              <li><strong>WorldEdit (.schem):</strong> Place in <code>.minecraft/config/worldedit/schematics/</code>. In game, run <code>//schem load &lt;name&gt;</code> and <code>//paste</code>.</li>
              <li><strong>Litematica (.litematic):</strong> Place in <code>.minecraft/schematics/</code>. In game, press <code>M</code> &rarr; <em>Load Schematics</em> and placement tool.</li>
              <li><strong>Activation:</strong> Connect a button or redstone lever to the starting input repeater to trigger full in-game musical playback!</li>
            </ul>
          </div>
        </section>
      ` : ''}

      <footer>
        <p>
          MIDI to Minecraft Note Block Converter &bull;
          <a href="//github.com/slopggobblercobbler81/midi-to-noteblock" target="_blank" rel="noreferrer">View on GitHub</a>
          &bull; 100% Client-Side Web Application
        </p>
      </footer>
    </main>
  `;

  // Attach Event Listeners
  attachEventListeners();

  // Setup Visualizer Canvas if present
  const canvas = document.getElementById('visualizer') as HTMLCanvasElement | null;
  if (canvas) {
    setupVisualizer(canvas);
  }
}

/**
 * Attaches DOM interaction handlers.
 */
function attachEventListeners(): void {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  const btnBrowse = document.getElementById('btnBrowse');
  const btnDemo = document.getElementById('btnDemo');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0]!;
        file.arrayBuffer().then((buf) => loadMidiBuffer(buf, file.name));
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0]!;
        file.arrayBuffer().then((buf) => loadMidiBuffer(buf, file.name));
      }
    });
  }

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', () => fileInput.click());
  }

  if (btnDemo) {
    btnDemo.addEventListener('click', loadDemoSong);
  }

  // Transport Controls
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnStop = document.getElementById('btnStop');
  const seekSlider = document.getElementById('seekSlider') as HTMLInputElement | null;
  const speedSelect = document.getElementById('speedSelect') as HTMLSelectElement | null;
  const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement | null;

  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      const state = audioPlayer.getState();
      if (state.isPlaying) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
      renderApp();
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', () => {
      audioPlayer.stop();
      renderApp();
    });
  }

  if (seekSlider) {
    seekSlider.addEventListener('input', () => {
      audioPlayer.seek(parseFloat(seekSlider.value));
    });
  }

  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      audioPlayer.setSpeed(parseFloat(speedSelect.value));
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      audioPlayer.setVolume(parseFloat(volumeSlider.value));
    });
  }

  // Conversion Settings
  const transposeInput = document.getElementById('transposeInput') as HTMLInputElement | null;
  const widthInput = document.getElementById('widthInput') as HTMLInputElement | null;
  const preserveKeyCheck = document.getElementById('preserveKeyCheck') as HTMLInputElement | null;
  const octaveFoldCheck = document.getElementById('octaveFoldCheck') as HTMLInputElement | null;

  if (transposeInput) {
    transposeInput.addEventListener('change', () => {
      conversionOptions.manualTranspose = parseInt(transposeInput.value, 10) || 0;
      recomputeTimeline();
      renderApp();
    });
  }

  if (widthInput) {
    widthInput.addEventListener('change', () => {
      maxTrackWidth = Math.max(5, Math.min(32, parseInt(widthInput.value, 10) || 16));
      renderApp();
    });
  }

  if (preserveKeyCheck) {
    preserveKeyCheck.addEventListener('change', () => {
      conversionOptions.preserveKey = preserveKeyCheck.checked;
      recomputeTimeline();
      renderApp();
    });
  }

  if (octaveFoldCheck) {
    octaveFoldCheck.addEventListener('change', () => {
      conversionOptions.enableOctaveFolding = octaveFoldCheck.checked;
      recomputeTimeline();
      renderApp();
    });
  }

  // Track Instrument Dropdowns
  document.querySelectorAll('.track-inst-select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const trackId = parseInt(select.getAttribute('data-track-id')!, 10);
      const chosen = select.value as MinecraftInstrument;
      if (!conversionOptions.instrumentOverrides) conversionOptions.instrumentOverrides = {};
      conversionOptions.instrumentOverrides[trackId] = chosen;
      recomputeTimeline();
      renderApp();
    });
  });

  // Track Mute & Solo
  document.querySelectorAll('.track-mute').forEach((el) => {
    el.addEventListener('click', (e) => {
      const btn = e.target as HTMLButtonElement;
      const trackId = parseInt(btn.getAttribute('data-track-id')!, 10);
      const isMuted = audioPlayer.getState().mutedTracks.has(trackId);
      audioPlayer.setTrackMute(trackId, !isMuted);
      renderApp();
    });
  });

  document.querySelectorAll('.track-solo').forEach((el) => {
    el.addEventListener('click', (e) => {
      const btn = e.target as HTMLButtonElement;
      const trackId = parseInt(btn.getAttribute('data-track-id')!, 10);
      const isSolo = audioPlayer.getState().soloTracks.has(trackId);
      audioPlayer.setTrackSolo(trackId, !isSolo);
      renderApp();
    });
  });

  // Export Buttons
  const btnExportSchem = document.getElementById('btnExportSchem');
  const btnExportLitematic = document.getElementById('btnExportLitematic');

  if (btnExportSchem && currentTimeline) {
    btnExportSchem.addEventListener('click', async () => {
      const result = await exportSpongeSchematic(currentTimeline!, {
        name: currentTimeline!.title,
        maxTrackWidth,
      });
      triggerBrowserDownload(result.filename, result.mimeType, result.data);
    });
  }

  if (btnExportLitematic && currentTimeline) {
    btnExportLitematic.addEventListener('click', async () => {
      const result = await exportLitematic(currentTimeline!, {
        name: currentTimeline!.title,
        maxTrackWidth,
      });
      triggerBrowserDownload(result.filename, result.mimeType, result.data);
    });
  }
}

// Audio Player Tick Callback to synchronize time display and seek slider
audioPlayer.onTick((state: AudioPlayerState) => {
  const timeDisplay = document.getElementById('timeDisplay');
  const seekSlider = document.getElementById('seekSlider') as HTMLInputElement | null;

  if (timeDisplay && currentTimeline) {
    timeDisplay.innerHTML = `
      ${formatTime(state.currentTime)} / ${formatTime(currentTimeline.durationSeconds)}
      <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Tick: ${state.currentRedstoneTick} / ${currentTimeline.totalRedstoneTicks}</span>
    `;
  }

  if (seekSlider && document.activeElement !== seekSlider) {
    seekSlider.value = state.currentTime.toString();
  }
});

audioPlayer.onEnded(() => {
  renderApp();
});

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderApp());
  } else {
    renderApp();
  }
}
