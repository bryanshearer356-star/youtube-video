// One command for the whole pipeline: [tella fetch] → prep → build → render → finish
//   npm run make -- <episode> [--fetch] [--draft]
import { fileURLToPath } from "node:url";
import { loadEpisode, run } from "./lib.mjs";

const [slug, ...flags] = process.argv.slice(2);
loadEpisode(slug); // validates the episode exists
const node = (script, ...args) => run(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args]);

if (flags.includes("--fetch")) node("./tella.mjs", "fetch", slug);
node("./prep.mjs", slug);
node("./build.mjs", slug);
node("./render.mjs", slug, ...(flags.includes("--draft") ? ["--draft"] : []));
node("./finish.mjs", slug);
