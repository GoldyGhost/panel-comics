// ============================================================
// scripts/enrich-covers-comicvine.js
//
// Complète cover_url pour les issues DÉJÀ présentes dans ta table
// `issues` (par ex. celles de bukkart_reading_guide.sql), via l'API
// Comic Vine, par correspondance titre de série + numéro. Ne crée
// aucune ligne : met seulement à jour cover_url sur les lignes
// existantes qui n'en ont pas encore.
//
// Usage :
//   node scripts/enrich-covers-comicvine.js
//   node scripts/enrich-covers-comicvine.js --series "House of M"
// ============================================================

import { createClient } from "@supabase/supabase-js";

const COMICVINE_API_KEY = process.env.COMICVINE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!COMICVINE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables d'environnement manquantes. Copie .env.example vers .env et remplis-le.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = "https://comicvine.gamespot.com/api";
const DELAY_MS = 700;
const HEADERS = { "User-Agent": "PANEL-comics-log/1.0 (contact: ton-email@example.com)" };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function cvGet(path, params = "") {
  const url = `${BASE_URL}${path}?api_key=${COMICVINE_API_KEY}&format=json${params ? "&" + params : ""}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Comic Vine ${res.status} sur ${path} : ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.status_code !== 1) throw new Error(`Comic Vine erreur "${json.error}" sur ${path}`);
  return json;
}

async function findBestVolume(title, approxYear) {
  const res = await cvGet("/search/", `resources=volume&query=${encodeURIComponent(title)}&field_list=id,name,start_year,publisher&limit=20`);
  const marvel = res.results.filter((v) => v.publisher?.name === "Marvel");
  const pool = marvel.length ? marvel : res.results;
  if (!pool.length) return null;
  if (!approxYear) return pool[0];
  return pool.reduce((best, v) => {
    const diff = Math.abs((v.start_year || 0) - approxYear);
    const bestDiff = Math.abs((best.start_year || 0) - approxYear);
    return diff < bestDiff ? v : best;
  }, pool[0]);
}

async function enrichSeries(seriesTitle) {
  const { data: rows, error } = await supabase
    .from("issues").select("id, number, year, cover_url")
    .eq("series_title", seriesTitle).is("cover_url", null);
  if (error) throw error;
  if (!rows.length) { console.log(`"${seriesTitle}" : rien à compléter.`); return; }

  const approxYear = rows.find((r) => r.year)?.year || null;
  const volume = await findBestVolume(seriesTitle, approxYear);
  if (!volume) { console.log(`"${seriesTitle}" : aucun volume Comic Vine trouvé, ignoré.`); return; }
  console.log(`"${seriesTitle}" → Comic Vine volume ${volume.id} ("${volume.name}", ${volume.start_year})`);

  const wanted = new Map(rows.map((r) => [String(r.number), r]));
  let offset = 0, total = Infinity, found = 0;
  while (offset < total) {
    const page = await cvGet(
      "/issues/",
      `filter=volume:${volume.id}&limit=100&offset=${offset}&sort=issue_number:asc&field_list=issue_number,image`
    );
    total = page.number_of_total_results;
    for (const issue of page.results) {
      const key = String(parseFloat(issue.issue_number));
      if (!wanted.has(key)) continue;
      const coverUrl = issue.image?.original_url || issue.image?.medium_url || null;
      if (!coverUrl) continue;
      const { error: updErr } = await supabase
        .from("issues").update({ cover_url: coverUrl })
        .eq("series_title", seriesTitle).eq("number", wanted.get(key).number).is("cover_url", null);
      if (updErr) console.error(`  erreur update #${key} :`, updErr.message);
      else { found++; console.log(`  ✓ #${key}`); }
    }
    offset += 100;
    await sleep(DELAY_MS);
  }
  console.log(`"${seriesTitle}" : ${found}/${wanted.size} couvertures trouvées.`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--series") ? args[args.indexOf("--series") + 1] : null;

  const { data: titles, error } = await supabase.from("issues").select("series_title").is("cover_url", null);
  if (error) throw error;
  const distinct = [...new Set(titles.map((t) => t.series_title))].filter((t) => !only || t === only);
  console.log(`${distinct.length} série(s) à traiter :`, distinct.join(", "));

  for (const title of distinct) {
    await enrichSeries(title);
    await sleep(DELAY_MS);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
