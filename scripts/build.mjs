// Step 3 — Build the HyperFrames composition.
// Generates episodes/<name>/build/index.html from episode.json:
//   [intro title card] → [Tella footage + lower-thirds + chapter labels] → [outro / subscribe card]
// with the Epidemic Sound track loud under the intro/outro and ducked under your voice.
// Open it in HyperFrames Studio (npm run preview) to tweak anything by hand afterwards.
import fs from "node:fs";
import path from "node:path";
import { ROOT, die, loadEpisode, probeDuration, resolutionOf, step, timestamp } from "./lib.mjs";

const ep = loadEpisode(process.argv[2]);
const c = ep.config;
const [W, H] = resolutionOf(c);
const assets = path.join(ep.build, "assets");
const footage = path.join(assets, "footage.mp4");
const music = path.join(assets, "music.m4a");
if (!fs.existsSync(footage)) die(`Missing ${footage}. Run npm run prep -- ${ep.slug} first.`);

const r = (n) => Math.round(n * 1000) / 1000;
const esc = (s = "") => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const brand = { background: "#0b0b10", text: "#f5f5f7", accent: "#ff3b5c", font: "Inter", ...c.brand };
const I = c.intro?.duration ?? 4;
const O = c.outro?.duration ?? 6;
const F = r(probeDuration(footage));
const T = r(I + F + O);
const scale = Math.min(W, H) / 1080; // keep type sizes proportional on portrait/square/4K
const px = (n) => `${Math.round(n * scale)}px`;

step(`Timeline: intro ${I}s + footage ${F}s + outro ${O}s = ${T}s`);

// ── Music: three clips cut from one track ──────────────────────────────────
let audioHtml = "";
if (fs.existsSync(music)) {
  const M = probeDuration(music);
  const m = { introVolume: 0.8, bedVolume: 0.08, outroVolume: 0.8, trackOffset: 0, ...c.music };
  const off = m.trackOffset;
  // If the track is long enough, keep it continuous; otherwise land on the track's real ending for the outro.
  const continuous = off + T <= M;
  const bedDur = r(Math.max(0, Math.min(F, M - off - I)));
  const outroStart = continuous ? off + I + F : Math.max(0, M - O);
  if (!continuous) console.log(`· Music (${r(M)}s) is shorter than the video (${T}s): the outro will use the track's ending instead.`);
  audioHtml = `
      <audio id="music-intro" src="assets/music.m4a" data-start="0" data-duration="${I}" data-media-start="${r(off)}"
        data-volume="${m.introVolume}" data-fade-in="0.5" data-fade-out="0.8"></audio>${
        bedDur > 0
          ? `
      <audio id="music-bed" src="assets/music.m4a" data-start="${I}" data-duration="${bedDur}" data-media-start="${r(off + I)}"
        data-volume="${m.bedVolume}" data-fade-in="0.8" data-fade-out="1"></audio>`
          : ""
      }
      <audio id="music-outro" src="assets/music.m4a" data-start="${r(I + F)}" data-duration="${O}" data-media-start="${r(outroStart)}"
        data-volume="${m.outroVolume}" data-fade-in="1" data-fade-out="${Math.min(2, O / 2)}"></audio>`;
}

// ── Lower-thirds and chapter labels ────────────────────────────────────────
const lowerThirds = (c.lowerThirds || []).map((lt, i) => ({ ...lt, id: `lt-${i}`, start: r(I + lt.at) }));
const chapters = (c.chapters || []).filter((ch) => ch.at > 0 && ch.at < F).map((ch, i) => ({ ...ch, id: `ch-${i}`, start: r(I + ch.at) }));
const CH_DUR = 3.5;

const ltHtml = lowerThirds
  .map(
    (lt) => `
      <div id="${lt.id}" class="clip lower-third" data-start="${lt.start}" data-duration="${lt.duration}" data-track-index="3">
        <div class="lt-bar"></div>
        <div class="lt-text"><div class="lt-name">${esc(lt.name)}</div><div class="lt-role">${esc(lt.role)}</div></div>
      </div>`,
  )
  .join("");
const chHtml = chapters
  .map(
    (ch) => `
      <div id="${ch.id}" class="clip chapter" data-start="${ch.start}" data-duration="${CH_DUR}" data-track-index="4">
        <span class="chapter-dot"></span>${esc(ch.title)}
      </div>`,
  )
  .join("");

// ── GSAP animation (absolute times on the root timeline) ───────────────────
const anim = [
  `tl.fromTo("#intro-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, 0.2);`,
  `tl.fromTo("#intro-title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.4);`,
  `tl.fromTo("#intro-subtitle", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 0.8);`,
  `tl.fromTo("#intro-channel", { opacity: 0 }, { opacity: 0.7, duration: 0.6 }, 1.1);`,
  `tl.to("#intro-inner", { opacity: 0, scale: 1.04, duration: 0.5, ease: "power2.in" }, ${r(I - 0.5)});`,
  `tl.fromTo("#footage", { opacity: 0 }, { opacity: 1, duration: 0.5 }, ${I});`,
  ...lowerThirds.flatMap((lt) => [
    `tl.fromTo("#${lt.id} .lt-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power3.out" }, ${lt.start});`,
    `tl.fromTo("#${lt.id} .lt-text", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, ${r(lt.start + 0.15)});`,
    `tl.to("#${lt.id}", { opacity: 0, x: -20, duration: 0.4, ease: "power2.in" }, ${r(lt.start + lt.duration - 0.4)});`,
  ]),
  ...chapters.flatMap((ch) => [
    `tl.fromTo("#${ch.id}", { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.6)" }, ${ch.start});`,
    `tl.to("#${ch.id}", { opacity: 0, y: -10, duration: 0.35 }, ${r(ch.start + CH_DUR - 0.35)});`,
  ]),
  `tl.fromTo("#outro-inner", { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.7, ease: "power3.out" }, ${r(I + F + 0.1)});`,
  `tl.fromTo("#outro-cta", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${r(I + F + 0.6)});`,
  `tl.to("#outro-inner", { opacity: 0, duration: 0.6 }, ${r(T - 0.6)});`,
  `tl.set({}, {}, ${T});`,
];

const fontLink = /^(system-ui|sans-serif|serif)$/i.test(brand.font)
  ? ""
  : `\n    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(brand.font)}:wght@400;600;800&display=block" />`;

const html = `<!doctype html>
<!-- Generated by scripts/build.mjs from episode.json. Re-running build overwrites this file. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />${fontLink}
    <script src="assets/gsap.min.js"></script>
    <style>
      :root { --bg: ${brand.background}; --text: ${brand.text}; --accent: ${brand.accent}; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--bg); }
      #root { position: relative; width: 100%; height: 100%; font-family: "${brand.font}", Inter, ui-sans-serif, system-ui, sans-serif; color: var(--text); }
      .clip { position: absolute; inset: 0; }
      .card { display: flex; align-items: center; justify-content: center; text-align: center; background: var(--bg); z-index: 5; }
      .card-inner { display: flex; flex-direction: column; align-items: center; gap: ${px(24)}; max-width: 80%; }
      #intro-bar { width: ${px(120)}; height: ${px(8)}; background: var(--accent); border-radius: ${px(4)}; transform-origin: left center; }
      #intro-title { font-size: ${px(92)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
      #intro-subtitle { font-size: ${px(40)}; font-weight: 400; opacity: 0.8; }
      #intro-channel { font-size: ${px(26)}; letter-spacing: 0.2em; text-transform: uppercase; }
      #footage { width: 100%; height: 100%; object-fit: cover; z-index: 1; background: #000; }
      .lower-third { inset: auto auto ${px(90)} ${px(90)}; display: flex; align-items: stretch; gap: ${px(20)}; z-index: 10; }
      .lt-bar { width: ${px(8)}; background: var(--accent); border-radius: ${px(4)}; transform-origin: bottom center; }
      .lt-text { background: rgba(0, 0, 0, 0.72); padding: ${px(18)} ${px(28)}; border-radius: ${px(10)}; }
      .lt-name { font-size: ${px(40)}; font-weight: 700; }
      .lt-role { font-size: ${px(26)}; opacity: 0.8; margin-top: ${px(4)}; }
      .chapter { inset: ${px(60)} auto auto ${px(60)}; height: fit-content; display: flex; align-items: center; gap: ${px(14)};
        background: rgba(0, 0, 0, 0.72); padding: ${px(14)} ${px(24)}; border-radius: ${px(999)}; font-size: ${px(28)}; font-weight: 600; z-index: 10; opacity: 0; }
      .chapter-dot { width: ${px(14)}; height: ${px(14)}; border-radius: 50%; background: var(--accent); }
      #outro-headline { font-size: ${px(84)}; font-weight: 800; letter-spacing: -0.03em; }
      #outro-cta { font-size: ${px(36)}; background: var(--accent); color: #fff; padding: ${px(18)} ${px(40)}; border-radius: ${px(999)}; font-weight: 600; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="${W}" data-height="${H}">
      <div id="intro" class="clip card" data-start="0" data-duration="${I}" data-track-index="0">
        <div id="intro-inner" class="card-inner">
          <div id="intro-bar"></div>
          <h1 id="intro-title">${esc(c.title)}</h1>
          ${c.subtitle ? `<p id="intro-subtitle">${esc(c.subtitle)}</p>` : ""}
          ${c.channel ? `<p id="intro-channel">${esc(c.channel)}</p>` : ""}
        </div>
      </div>

      <video id="footage" class="clip" src="assets/footage.mp4" data-start="${I}" data-duration="${F}" data-has-audio="true" data-track-index="1" playsinline></video>
${ltHtml}${chHtml}
      <div id="outro" class="clip card" data-start="${r(I + F)}" data-duration="${O}" data-track-index="0">
        <div id="outro-inner" class="card-inner">
          <h2 id="outro-headline">${esc(c.outro?.headline || "Thanks for watching")}</h2>
          ${c.outro?.cta ? `<p id="outro-cta">${esc(c.outro.cta)}</p>` : ""}
        </div>
      </div>
${audioHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${anim.join("\n      ")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(ep.build, "index.html"), html);
// GSAP is bundled locally (not loaded from a CDN) so renders work offline and are reproducible.
fs.copyFileSync(path.join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js"), path.join(assets, "gsap.min.js"));
fs.writeFileSync(path.join(ep.build, "meta.json"), JSON.stringify({ id: ep.slug, name: c.title }, null, 2) + "\n");
fs.writeFileSync(
  path.join(ep.build, "hyperframes.json"),
  JSON.stringify(
    {
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      media: { autoProxy: true },
    },
    null,
    2,
  ) + "\n",
);

// YouTube chapters for the description (shifted by the intro length; YouTube needs the first at 0:00).
fs.mkdirSync(ep.out, { recursive: true });
const ytChapters = [{ t: 0, title: c.chapters?.[0]?.at === 0 ? c.chapters[0].title : "Intro" }]
  .concat((c.chapters || []).filter((ch) => ch.at > 0).map((ch) => ({ t: I + ch.at, title: ch.title })))
  .map((ch) => `${timestamp(ch.t)} ${ch.title}`)
  .join("\n");
fs.writeFileSync(path.join(ep.out, "chapters.txt"), ytChapters + "\n");

console.log(`✓ Wrote ${path.relative(ROOT, path.join(ep.build, "index.html"))}`);
console.log(`✓ Wrote ${path.relative(ROOT, path.join(ep.out, "chapters.txt"))} (paste into your YouTube description)`);
console.log(`\nNext: npm run preview -- ${ep.slug}   (optional, tweak in Studio)\n      npm run render -- ${ep.slug}`);
