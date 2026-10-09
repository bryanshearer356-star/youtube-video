# YouTube Video Editing System

**Tella** (record) → **FFmpeg** (clean up) → **HyperFrames** (titles, lower-thirds, chapters, music mix) → **FFmpeg** (master for YouTube), with **Epidemic Sound** music.

```
 ┌─────────┐   ┌──────────────┐   ┌───────────────────┐   ┌──────────────┐
 │  Tella  │──▶│ FFmpeg prep  │──▶│ HyperFrames build │──▶│ FFmpeg finish│──▶ upload to YouTube
 │ record  │   │ trim, resize,│   │ intro + footage + │   │ -14 LUFS,    │    • final .mp4
 │ + trim  │   │ voice -16LUFS│   │ lower-thirds +    │   │ thumbnail    │    • thumbnail.jpg
 └─────────┘   └──────▲───────┘   │ chapters + outro  │   └──────────────┘    • chapters.txt
                      │           └───────────────────┘
          Epidemic Sound track (music/)
```

One command does the whole thing once your files are in place:

```bash
npm run make -- my-video
```

---

## Part 1 — One-time setup (≈15 minutes)

### Step 1. Install Node.js 22+
Download the LTS installer from <https://nodejs.org> (must be version 22 or newer). Check with:
```bash
node --version
```

### Step 2. Install FFmpeg
| OS | Command |
|---|---|
| macOS | `brew install ffmpeg` (install Homebrew first from <https://brew.sh>) |
| Windows | `winget install Gyan.FFmpeg` then reopen your terminal |
| Linux | `sudo apt install ffmpeg` |

Check with `ffmpeg -version`.

### Step 3. Get this project and install HyperFrames
```bash
git clone https://github.com/bryanshearer356-star/youtube-video.git
cd youtube-video
npm install                         # installs HyperFrames + GSAP (pinned versions)
npx hyperframes browser ensure      # downloads the headless Chrome HyperFrames renders with
npm run doctor                      # confirms everything is ready
```
`doctor` will list whisper / Kokoro / MusicGen / Docker as missing — those are optional HyperFrames extras you don't need.

### Step 4. Set up Tella
1. Sign up at <https://www.tella.com> and install the desktop recorder.
2. In Tella's recording settings, record at **1080p or 4K**.
3. *(Optional, for automatic downloads)* create an API key: **Workspace settings → API**. Then:
   ```bash
   cp .env.example .env
   ```
   and paste the key (starts with `tella_pk_`) after `TELLA_API_KEY=`.

### Step 5. Set up Epidemic Sound
1. Get a **Creator/Pro** subscription at <https://www.epidemicsound.com> (needed to monetise on YouTube).
2. **Connect your YouTube channel** in your Epidemic Sound account settings. This clears Content ID claims on videos using their music — do this *before* uploading.
3. Optional: add the **Epidemic Sound connector** in Claude (Settings → Connectors) so you can ask Claude to find tracks by mood/BPM.

---

## Part 2 — Making a video (every time)

### Step 1. Record in Tella
Record your video. Use Tella's editor for the *content* edits — cutting mistakes, removing filler words/silences, layouts, camera bubble. Leave titles, music and branding out; this system adds those.

### Step 2. Create an episode folder
```bash
npm run new -- my-first-video
```
This creates:
```
episodes/my-first-video/
  episode.json   ← titles, chapters, lower-thirds, colours, music levels
  raw/           ← your Tella export goes here
  music/         ← your Epidemic Sound track goes here
```

### Step 3. Get the recording out of Tella
**Option A — automatic (API key set):**
```bash
npm run tella:list                              # shows your videos and their IDs
npm run tella:fetch -- my-first-video <videoId> # exports + downloads to raw/tella.mp4
```
**Option B — manual:** in Tella click **Download → MP4 (1080p or 4K)** and drop the file into `episodes/my-first-video/raw/`.

### Step 4. Pick music on Epidemic Sound
Download a track (MP3 or WAV) and drop it into `episodes/my-first-video/music/`.
Tips:
- Pick something without vocals — it sits under your voice.
- Epidemic Sound offers **stems**; the "no melody" or "drums + bass" stem makes an even better voice bed.
- If the track is shorter than your video the system automatically uses the track's real ending for the outro.

### Step 5. Fill in `episode.json`
```jsonc
{
  "title": "How I Edit My YouTube Videos",      // intro title card
  "subtitle": "Tella + HyperFrames + FFmpeg",
  "channel": "Your Channel Name",
  "resolution": "landscape",                     // landscape | portrait (Shorts) | square | landscape-4k
  "fps": 30,
  "tellaVideoId": "",                            // lets you run tella:fetch without the ID

  "footage": { "trimStart": 0, "trimEnd": null },// seconds to cut off the start/end of the recording

  "intro": { "duration": 4 },
  "outro": { "duration": 6, "headline": "Thanks for watching", "cta": "Subscribe for more videos like this" },

  "music": {
    "introVolume": 0.8,   // music level over the title card
    "bedVolume": 0.08,    // music level under your voice (0.05–0.12 is typical)
    "outroVolume": 0.8,
    "trackOffset": 0      // start the song N seconds in
  },

  // "at" times are seconds into your Tella recording (after trimStart)
  "lowerThirds": [{ "at": 2, "duration": 5, "name": "Your Name", "role": "Creator" }],
  "chapters": [
    { "at": 0, "title": "Intro" },
    { "at": 30, "title": "Recording in Tella" }
  ],

  "thumbnailAt": 2.5,     // seconds into the FINAL video to grab the thumbnail (2.5 = title card)
  "brand": { "background": "#0b0b10", "text": "#f5f5f7", "accent": "#ff3b5c", "font": "Inter" }
}
```
`font` can be any Google Fonts family name, or `system-ui` to use no web font.

### Step 6. Run the pipeline
```bash
npm run make -- my-first-video            # prep → build → render → finish
npm run make -- my-first-video --fetch    # also pulls the video from Tella first
npm run make -- my-first-video --draft    # faster, lower-quality render for checking
```
Or step by step:

| Command | Tool | What it does |
|---|---|---|
| `npm run prep -- <ep>` | FFmpeg | Trims, scales to the canvas, constant 30fps, removes low rumble, normalises voice to -16 LUFS; loudness-matches the music |
| `npm run build -- <ep>` | HyperFrames | Generates `build/index.html`: intro card → footage → outro, animated lower-thirds and chapter labels, music clips with volume/fades; writes `out/chapters.txt` |
| `npm run preview -- <ep>` | HyperFrames Studio | *(optional)* opens the composition in your browser to scrub and tweak |
| `npm run render -- <ep>` | HyperFrames | Lints the composition and renders `out/render.mp4` |
| `npm run finish -- <ep>` | FFmpeg | Masters audio to -14 LUFS / -1 dBTP (YouTube's target), fast-start MP4, 1280×720 thumbnail |

### Step 7. Upload to YouTube
From `episodes/my-first-video/out/`:
- `my-first-video.mp4` → the video
- `thumbnail.jpg` → custom thumbnail (or design your own)
- `chapters.txt` → paste into the description (YouTube turns these into chapters; times already include the intro)

---

## Customising the look
- **Colours/font:** `brand` in `episode.json`.
- **Layout and animations:** edit `scripts/build.mjs` — the CSS and GSAP lines are near the bottom. Changes apply to every future episode.
- **One-off tweaks:** `npm run preview -- <ep>` and edit in HyperFrames Studio. Note that re-running `build` regenerates `index.html` and overwrites hand edits, so after tweaking in Studio go straight to `render` + `finish`.
- **YouTube Shorts:** set `"resolution": "portrait"`; footage is fitted into 1080×1920.
- **AI-assisted edits:** `npx hyperframes skills` installs HyperFrames skills for Claude Code, so you can ask Claude to add effects or new scenes to a build.

## Troubleshooting
| Problem | Fix |
|---|---|
| `Chrome Headless Shell is required` | `npx hyperframes browser ensure` |
| `No video in …/raw` | Put the Tella MP4 in that episode's `raw/` folder |
| Music too loud/quiet under voice | Change `music.bedVolume` and re-run `npm run make` |
| Lint warnings about "nested structure" | Safe to ignore — they're Studio display hints, not render errors |
| Tella export never finishes | Check the video in Tella, or use the manual download (Step 3, Option B) |
| Content ID claim on the music | Make sure your channel is connected in Epidemic Sound, then dispute the claim from YouTube Studio |
