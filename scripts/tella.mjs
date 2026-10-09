// Tella API helper.
//   npm run tella:list                         list your Tella videos and their IDs
//   npm run tella:fetch -- <episode> [videoId] export a video and download it into episodes/<episode>/raw/
// API reference: https://www.tella.com/docs/introduction
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { die, loadEpisode, step } from "./lib.mjs";

const API = "https://api.tella.com/v1";
const KEY = process.env.TELLA_API_KEY;
if (!KEY) die("TELLA_API_KEY is not set. Copy .env.example to .env and paste your key (Tella → Workspace settings → API).");

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) die(`Tella API ${method} ${route} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

// Responses may wrap results (e.g. { data: [...] } / { videos: [...] }); accept either shape.
const listOf = (r, key) => (Array.isArray(r) ? r : r[key] || r.data || r.items || []);
const unwrap = (r, key) => r[key] || r.data || r;

async function list() {
  const videos = listOf(await api("GET", "/videos"), "videos");
  if (!videos.length) return console.log("No videos found.");
  for (const v of videos) console.log(`${v.id}  ${v.name || v.title || "(untitled)"}`);
}

async function fetchVideo(slug, videoIdArg) {
  const ep = loadEpisode(slug);
  const videoId = videoIdArg || ep.config.tellaVideoId;
  if (!videoId) die("Pass a Tella video ID or set \"tellaVideoId\" in episode.json. Find IDs with `npm run tella:list`.");

  step(`Starting Tella export for ${videoId}`);
  const started = unwrap(await api("POST", `/videos/${encodeURIComponent(videoId)}/exports`, {}), "export");
  const exportId = started.id || started.exportId;
  if (!exportId) die(`Unexpected export response: ${JSON.stringify(started)}`);

  // Export IDs contain slashes, so they must be encoded as one path segment.
  const statusRoute = `/videos/${encodeURIComponent(videoId)}/exports/${encodeURIComponent(exportId)}`;
  let url = null;
  for (let i = 0; i < 180 && !url; i++) {
    const s = unwrap(await api("GET", statusRoute), "export");
    const state = String(s.status || s.state || "").toLowerCase();
    url = s.downloadUrl || s.download_url || null;
    if (["failed", "error", "cancelled", "canceled"].includes(state)) die(`Export ${state}: ${JSON.stringify(s)}`);
    if (!url) {
      process.stdout.write(`\r  status: ${state || "processing"}${s.progress != null ? ` ${s.progress}%` : ""}   `);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!url) die("Timed out waiting for the export (15 min). Try again later or download it from Tella manually.");

  fs.mkdirSync(ep.raw, { recursive: true });
  const dest = path.join(ep.raw, "tella.mp4");
  step(`Downloading to ${path.relative(process.cwd(), dest)}`);
  const res = await fetch(url);
  if (!res.ok) die(`Download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  console.log("✓ Done. Next: npm run prep -- " + slug);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "list") await list();
else if (cmd === "fetch") await fetchVideo(...args);
else die("Usage: node scripts/tella.mjs list | fetch <episode> [videoId]");
