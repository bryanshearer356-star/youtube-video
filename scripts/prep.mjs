// Step 2 — FFmpeg prep.
// Turns the raw Tella export and the Epidemic Sound track into clean, predictable
// assets for HyperFrames:
//   footage: trimmed, scaled/padded to the canvas, constant frame rate, voice at -16 LUFS
//   music:   loudness-matched to -16 LUFS so the volumes in episode.json mean the same thing every time
import fs from "node:fs";
import path from "node:path";
import { AUDIO_EXTS, VIDEO_EXTS, die, ffmpeg, findMedia, loadEpisode, loudnormFilter, resolutionOf, step } from "./lib.mjs";

const ep = loadEpisode(process.argv[2]);
const { config } = ep;
const [W, H] = resolutionOf(config);
const fps = config.fps || 30;
const assets = path.join(ep.build, "assets");
fs.mkdirSync(assets, { recursive: true });

// ── Footage ────────────────────────────────────────────────────────────────
const raw = findMedia(ep.raw, VIDEO_EXTS);
if (!raw) die(`No video in ${ep.raw}. Export from Tella (or run npm run tella:fetch -- ${ep.slug}).`);

const { trimStart = 0, trimEnd = null } = config.footage || {};
const trimArgs = [...(trimStart ? ["-ss", String(trimStart)] : []), ...(trimEnd ? ["-to", String(trimEnd)] : [])];

step(`Measuring voice loudness in ${path.basename(raw)}`);
// Gentle cleanup for a talking voice: cut rumble below 80 Hz, then normalise to -16 LUFS.
const voiceFilter = loudnormFilter(raw, { I: -16, inputArgs: trimArgs, preFilter: "highpass=f=80" });

step(`Encoding footage → ${W}x${H} @ ${fps}fps`);
ffmpeg([
  ...trimArgs,
  "-i", raw,
  "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p`,
  "-af", `${voiceFilter},aresample=48000`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart",
  path.join(assets, "footage.mp4"),
]);

// ── Music ──────────────────────────────────────────────────────────────────
const music = findMedia(ep.music, AUDIO_EXTS);
const musicOut = path.join(assets, "music.m4a");
if (music) {
  step(`Loudness-matching music: ${path.basename(music)}`);
  const musicFilter = loudnormFilter(music, { I: -16 });
  ffmpeg(["-i", music, "-vn", "-af", `${musicFilter},aresample=48000`, "-c:a", "aac", "-b:a", "256k", musicOut]);
} else {
  fs.rmSync(musicOut, { force: true });
  console.log(`\n· No music in ${ep.music} — video will have voice only. Drop an Epidemic Sound track there and re-run prep to add one.`);
}

console.log(`\n✓ Prep done. Next: npm run build -- ${ep.slug}`);
