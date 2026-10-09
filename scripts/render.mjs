// Step 4 — Render the HyperFrames composition to MP4 (headless Chrome + FFmpeg).
//   npm run render -- <episode> [--draft]
import fs from "node:fs";
import path from "node:path";
import { die, loadEpisode, run, step } from "./lib.mjs";

const ep = loadEpisode(process.argv[2]);
const draft = process.argv.includes("--draft");
if (!fs.existsSync(path.join(ep.build, "index.html"))) die(`Run npm run build -- ${ep.slug} first.`);
fs.mkdirSync(ep.out, { recursive: true });
const npx = (args) => run("npx", ["hyperframes", ...args], { cwd: ep.build, shell: process.platform === "win32" });

step("Linting composition");
npx(["lint", "."]);

step(`Rendering (${draft ? "draft" : "high"} quality) — this can take a while`);
npx([
  "render",
  "-o", path.join(ep.out, "render.mp4"),
  "--fps", String(ep.config.fps || 30),
  "--quality", draft ? "draft" : "high",
  "--video-frame-format", "png", // keeps screen-recording text/UI crisp
]);
console.log(`\n✓ Rendered ${path.join(ep.out, "render.mp4")}\nNext: npm run finish -- ${ep.slug}`);
