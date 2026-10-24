# Original User Request

## 2026-10-24T17:42:35Z

A pure client-side web application hosted on GitHub Pages that converts MIDI files into playable Minecraft note block schematics with an interactive in-browser audio preview simulating Minecraft note block playback.

Working directory: D:\midi_to_noteblock
Integrity mode: development

## Requirements

### R1. MIDI Parsing & User Interface
The web application must allow users to upload or drag-and-drop standard MIDI files (`.mid`). It extracts tracks, notes, tempos, and instrument program assignments, presenting track selection, playback controls, and conversion options in a responsive interface.

### R2. Smart Note Block Conversion & Quantization
The converter must process MIDI data to conform to Minecraft note block mechanics:
- Map MIDI pitches to the 2-octave note block range (25 semitones, F#3 to F#5) using intelligent transposition and octave-folding to preserve musical harmony.
- Map MIDI instrument families to corresponding Minecraft note block instrument base materials (e.g., wood for bass, stone for snare, sand/gravel for clicks, dirt/generic for harp/piano, etc.).
- Quantize note onset timings to redstone tick intervals (10 ticks per second / 0.1s increments).

### R3. In-Browser Minecraft Note Block Audio Preview
The application must include an in-browser audio player simulating Minecraft note block sounds across standard instruments. Users can preview the quantized and mapped song with playback controls (play, pause, stop, seek bar, volume, and playback speed).

### R4. Minecraft Schematic Export (.schem & .litematic)
The application must generate downloadable, valid Minecraft schematic files:
- Support modern `.schem` (WorldEdit / Sponge format) and `.litematic` (Litematica format).
- Lay out note blocks with correct block states (pitch 0–24, instrument block below) and redstone repeaters configured with proper delays to recreate the musical sequence when powered.

### R5. GitHub Pages Deployment Configuration
The project must be configured as a standalone client-side application with automated GitHub Pages deployment configuration (e.g., GitHub Actions workflow) and documentation so it can be built and served directly on GitHub Pages.

## Acceptance Criteria

### Automated Verification & Integrity
- [ ] Automated test suite verifies parsing of multi-track and polyphonic MIDI files with dynamic tempo changes.
- [ ] Unit tests verify pitch clamping / octave folding maps all output notes strictly into Minecraft's 0–24 note range.
- [ ] Unit tests verify time quantization properly aligns note onsets to 0.1s redstone tick boundaries.
- [ ] Automated schema validator confirms exported `.schem` and `.litematic` files have valid NBT structure, tags, block palettes, and metadata readable by standard Minecraft schematic tools.
- [ ] Static build succeeds cleanly with zero external runtime server dependencies.
- [ ] Automated lint/type/test check passes in CI without warnings or errors.

### Functional Web App Verification
- [ ] Uploading a sample MIDI file displays song duration, tempo, and playable track channels.
- [ ] Audio preview reproduces the melody using Minecraft note block sound synthesis or samples in real time.
- [ ] User can download the generated `.schem` and `.litematic` files directly from the browser.
- [ ] GitHub Actions workflow file is provided and validates build and deployment to GitHub Pages.
