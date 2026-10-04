// ============================================================
// scripts/lib/comicvine.js — shared Comic Vine client
//
// Comic Vine allows ~200 requests per resource per hour, plus a
// "velocity detection" that blocks bursts (HTTP 420 / status_code 107).
// This client:
//   - keeps a sliding one-hour window PER RESOURCE (issues, issue,
//     volumes, volume, search…) and pauses on its own before reaching
//     the quota, instead of crashing;
//   - enforces a minimum gap between any two requests;
//   - if a 420/429/107 still happens, waits a flat 1 hour and retries
//     the SAME request (no progressive backoff);
//   - retries transient network errors;
//   - caches identical requests during a run (same volume listed once,
//     not once per storyline).
// ============================================================

const API_KEY = process.env.COMICVINE_API_KEY;
const BASE_URL = "https://comicvine.gamespot.com/api";
const HEADERS = { "User-Agent": "PANEL-comics-log/1.0 (contact: ton-email@example.com)" };

const MAX_PER_HOUR = 170;      // official limit is 200; keep a safety margin
const MIN_INTERVAL_MS = 1100;  // stay under the per-second velocity detection
const HOUR_MS = 60 * 60 * 1000;
const MAX_RATE_RETRIES = 6;
const MAX_NETWORK_RETRIES = 4;
const MAX_SERVER_RETRIES = 6;
const WAIT_SCALE = Number(process.env.CV_WAIT_SCALE || 1); // tests only

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const windows = new Map();     // bucket -> [timestamps of requests in the last hour]
const cache = new Map();       // full URL -> parsed JSON
let lastRequestAt = 0;

function bucketOf(path) {
  return path.split("/").filter(Boolean)[0] || "root"; // "/issues/" -> "issues"
}
function clock(ts) {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function waitForSlot(bucket) {
  const win = windows.get(bucket) || [];
  windows.set(bucket, win);
  while (true) {
    const now = Date.now();
    while (win.length && now - win[0] >= HOUR_MS) win.shift();
    if (win.length < MAX_PER_HOUR) break;
    const resumeAt = win[0] + HOUR_MS + 2000;
    console.log(`  ⏸  Quota "${bucket}" atteint (${win.length}/h) — pause jusqu'à ${clock(resumeAt)}…`);
    await sleep(resumeAt - now);
  }
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - gap);
  lastRequestAt = Date.now();
  win.push(lastRequestAt);
}

export async function cvGet(path, params = "") {
  const url = `${BASE_URL}${path}?api_key=${API_KEY}&format=json${params ? "&" + params : ""}`;
  if (cache.has(url)) return cache.get(url);

  const bucket = bucketOf(path);
  let rateAttempts = 0, netAttempts = 0, serverAttempts = 0;

  while (true) {
    await waitForSlot(bucket);

    let res, body;
    try {
      res = await fetch(url, { headers: HEADERS });
      body = await res.text();
    } catch (e) {
      if (++netAttempts > MAX_NETWORK_RETRIES) throw new Error(`Comic Vine réseau sur ${path} : ${e.message}`);
      console.log(`  ⚠ erreur réseau (${e.message}), nouvel essai dans 10 s…`);
      await sleep(10000);
      continue;
    }

    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }

    const rateLimited = res.status === 420 || res.status === 429 || (json && json.status_code === 107);
    if (rateLimited) {
      if (++rateAttempts > MAX_RATE_RETRIES) {
        throw new Error(`Comic Vine limite de débit persistante sur ${path} — réessaie plus tard.`);
      }
      console.log(`  ⏸  Limite Comic Vine atteinte — pause fixe d'1h (reprise vers ${clock(Date.now() + 60 * 60000)}), puis on réessaie.`);
      await sleep(60 * 60000 * WAIT_SCALE);
      windows.set(bucket, []); // start counting afresh after the pause
      continue;
    }

    // Comic Vine (or a proxy in front of it) occasionally answers a
    // plain request with a 502/503/504 HTML error page — a passing
    // outage, not a real problem with the request. Retry it instead
    // of crashing the whole run over one blip.
    const serverError = res.status >= 500 && res.status < 600;
    if (serverError) {
      if (++serverAttempts > MAX_SERVER_RETRIES) {
        throw new Error(`Comic Vine ${res.status} persistant sur ${path} après ${MAX_SERVER_RETRIES} essais — réessaie plus tard.`);
      }
      const waitS = Math.min(120, 5 * 2 ** (serverAttempts - 1));
      console.log(`  ⚠ Comic Vine a répondu ${res.status} (panne passagère probable), nouvel essai dans ${waitS} s…`);
      await sleep(waitS * 1000 * WAIT_SCALE);
      continue;
    }

    if (!res.ok) throw new Error(`Comic Vine ${res.status} sur ${path} : ${body.slice(0, 200)}`);
    if (!json) throw new Error(`Comic Vine : réponse illisible sur ${path}`);
    if (json.status_code !== 1) throw new Error(`Comic Vine erreur "${json.error}" sur ${path}`);

    cache.set(url, json);
    return json;
  }
}