// Optional — open the generated composition in HyperFrames Studio to fine-tune by hand.
// Note: re-running `npm run build` regenerates index.html and overwrites Studio edits.
import { loadEpisode, run } from "./lib.mjs";

const ep = loadEpisode(process.argv[2]);
run("npx", ["hyperframes", "preview"], { cwd: ep.build, shell: process.platform === "win32" });
