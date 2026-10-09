// Checks that everything the pipeline needs is installed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

let ok = true;
function check(label, pass, hint) {
  console.log(`${pass ? "✓" : "✗"} ${label}${pass ? "" : `\n    → ${hint}`}`);
  if (!pass) ok = false;
}
const has = (cmd) => !spawnSync(cmd, ["-version"], { encoding: "utf8" }).error;

const [major] = process.versions.node.split(".").map(Number);
check(`Node.js ${process.versions.node}`, major >= 22, "Install Node.js 22 or newer from https://nodejs.org");
check("FFmpeg", has("ffmpeg"), "Mac: `brew install ffmpeg` · Windows: `winget install Gyan.FFmpeg` · Linux: `sudo apt install ffmpeg`");
check("FFprobe", has("ffprobe"), "Comes with FFmpeg; reinstall FFmpeg");
check(
  "HyperFrames installed",
  fs.existsSync(path.join(ROOT, "node_modules", "hyperframes")),
  "Run `npm install` in this folder",
);
const env = fs.existsSync(path.join(ROOT, ".env")) && /TELLA_API_KEY=\S+/.test(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
console.log(`${env ? "✓" : "·"} Tella API key ${env ? "found" : "not set (optional — you can download from Tella manually)"}`);

console.log("\nHyperFrames' own check (Chrome for rendering etc.):");
spawnSync("npx", ["hyperframes", "doctor"], { stdio: "inherit", cwd: ROOT, shell: process.platform === "win32" });
console.log(ok ? "\nCore requirements OK." : "\nFix the ✗ items above, then run `npm run doctor` again.");
process.exit(ok ? 0 : 1);
