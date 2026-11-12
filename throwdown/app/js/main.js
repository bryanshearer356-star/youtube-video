// Entry point. The same bundle runs as the page and, when started inside a
// Web Worker, as the background deck builder.
import { createDb } from './data.js';
import { runBuild, slim } from './job.js';
import { start } from './app.js';

if (typeof document === 'undefined') {
  let db = null;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') { db = createDb(m.raw); return; }
    if (m.type !== 'build') return;
    try {
      let last = 0;
      const res = await runBuild(db, m.job, async (f, msg) => {
        const now = Date.now();
        if (now - last > 60 || f === 1) { last = now; self.postMessage({ type: 'progress', id: m.id, f, msg }); }
      });
      self.postMessage({ type: 'done', id: m.id, res: slim(res) });
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, error: String(err.message || err) });
    }
  };
} else {
  start();
}
