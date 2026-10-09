// Step 5 — FFmpeg finishing for YouTube.
//   • final mix normalised to -14 LUFS / -1 dBTP (YouTube's playback loudness)
//   • faststart MP4 (video stream copied, no quality loss)
//   • 1280x720 thumbnail JPEG
import fs from "node:fs";
import path from "node:path";
import { die, ffmpeg, loadEpisode, loudnormFilter, step } from "./lib.mjs";

const ep = loadEpisode(process.argv[2]);
const rendered = path.join(ep.out, "render.mp4");
if (!fs.existsSync(rendered)) die(`Run npm run render -- ${ep.slug} first.`);
const final = path.join(ep.out, `${ep.slug}.mp4`);

step("Measuring final mix loudness");
const filter = loudnormFilter(rendered, { I: -14, TP: -1 });

step("Mastering audio to -14 LUFS");
ffmpeg(["-i", rendered, "-c:v", "copy", "-af", `${filter},aresample=48000`, "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", final]);

step("Grabbing thumbnail");
const thumb = path.join(ep.out, "thumbnail.jpg");
ffmpeg([
  "-ss", String(ep.config.thumbnailAt ?? 2.5),
  "-i", final,
  "-frames:v", "1",
  "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
  "-q:v", "3",
  thumb,
]);

console.log(`
✓ Ready to upload:
   ${final}
   ${thumb}
   ${path.join(ep.out, "chapters.txt")}  ← paste into the YouTube description`);
