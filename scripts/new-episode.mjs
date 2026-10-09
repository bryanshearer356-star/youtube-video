// Creates episodes/<name>/ with a starter episode.json and raw/ + music/ folders.
import fs from "node:fs";
import path from "node:path";
import { EPISODES, die } from "./lib.mjs";

const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die("Usage: npm run new -- my-video-name   (lowercase letters, numbers, dashes)");
const dir = path.join(EPISODES, slug);
if (fs.existsSync(dir)) die(`${dir} already exists`);

fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
fs.mkdirSync(path.join(dir, "music"), { recursive: true });
fs.copyFileSync(path.join(EPISODES, "example", "episode.json"), path.join(dir, "episode.json"));

console.log(`Created ${path.relative(process.cwd(), dir)}/
  episode.json   ← edit title, chapters, lower-thirds, brand colours
  raw/           ← put your Tella export here (or run: npm run tella:fetch -- ${slug} <videoId>)
  music/         ← put your Epidemic Sound track here`);
