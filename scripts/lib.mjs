// Shared helpers for the pipeline scripts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EPISODES = path.join(ROOT, "episodes");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // .env is optional; only the Tella step needs it.
}

export function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

export function step(msg) {
  console.log(`\n▶ ${msg}`);
}

/** Resolve an episode by slug and load its episode.json. */
export function loadEpisode(slug) {
  if (!slug) die("Pass an episode name, e.g. `npm run prep -- my-first-video`");
  const dir = path.join(EPISODES, slug);
  const cfgPath = path.join(dir, "episode.json");
  if (!fs.existsSync(cfgPath)) die(`No episode found at ${cfgPath}. Create one with \`npm run new -- ${slug}\``);
  const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  return {
    slug,
    dir,
    config,
    raw: path.join(dir, "raw"),
    music: path.join(dir, "music"),
    build: path.join(dir, "build"),
    out: path.join(dir, "out"),
  };
}

/** Run a command, streaming output; exit on failure. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", ...opts });
  if (res.error) die(`Could not run ${cmd}: ${res.error.message}`);
  if (res.status !== 0) {
    if (opts.capture) process.stderr.write(res.stderr || "");
    die(`${cmd} exited with code ${res.status}`);
  }
  return res;
}

export function ffmpeg(args) {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-stats", "-y", ...args]);
}

/** Duration in seconds of a media file, via ffprobe. */
export function probeDuration(file) {
  const res = run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { capture: true },
  );
  return Number.parseFloat(res.stdout.trim());
}

/** Two-pass EBU R128 loudness normalisation filter string for ffmpeg. */
export function loudnormFilter(file, { I, TP = -1.5, LRA = 11, inputArgs = [], preFilter = "" }) {
  const pre = preFilter ? `${preFilter},` : "";
  const res = spawnSync(
    "ffmpeg",
    ["-hide_banner", ...inputArgs, "-i", file, "-af", `${pre}loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, "-vn", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const match = res.stderr.match(/\{[\s\S]*?\}/g)?.pop();
  if (!match) die(`Could not measure loudness of ${file}`);
  const m = JSON.parse(match);
  return (
    `${pre}loudnorm=I=${I}:TP=${TP}:LRA=${LRA}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  );
}

/** First file in a folder matching one of the extensions. */
export function findMedia(dir, exts) {
  if (!fs.existsSync(dir)) return null;
  const file = fs
    .readdirSync(dir)
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .sort()[0];
  return file ? path.join(dir, file) : null;
}

export const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
export const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"];

export const RESOLUTIONS = {
  landscape: [1920, 1080],
  portrait: [1080, 1920],
  square: [1080, 1080],
  "landscape-4k": [3840, 2160],
};

export function resolutionOf(config) {
  const r = RESOLUTIONS[config.resolution || "landscape"];
  if (!r) die(`Unknown resolution "${config.resolution}". Use one of: ${Object.keys(RESOLUTIONS).join(", ")}`);
  return r;
}

/** Seconds -> YouTube chapter timestamp (m:ss or h:mm:ss). */
export function timestamp(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
