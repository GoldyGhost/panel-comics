// ============================================================
// scripts/enrich-covers.js
// ⚠️ Idem : utilise plutôt scripts/enrich-covers-comicvine.js (portail Marvel fermé depuis le 29/10/2025).
//
// Complète cover_url (et writer/artist si vides) pour les issues
// DÉJÀ présentes dans ta table `issues` (par ex. celles ajoutées via
// bukkart_reading_guide.sql), en les faisant correspondre à l'API
// Marvel par titre de série + numéro. Ne crée AUCUNE ligne : il ne
// fait que mettre à jour cover_url sur les lignes existantes, donc
// pas de risque de doublon.
//
// Nécessite les mêmes variables que scripts/import-marvel.js
// (voir .env.example) : MARVEL_PUBLIC_KEY, MARVEL_PRIVATE_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Usage :
//   node scripts/enrich-covers.js
//   node scripts/enrich-covers.js --series "House of M"   (une seule série)
// ============================================================

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MARVEL_PUBLIC_KEY = process.env.MARVEL_PUBLIC_KEY;
const MARVEL_PRIVATE_KEY = process.env.MARVEL_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MARVEL_PUBLIC_KEY || !MARVEL_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables d'environnement manquantes. Copie .env.example vers .env et remplis-le.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = "https://gateway.marvel.com/v1/public";
const DELAY_MS = 400;

function marvelAuthParams() {
  const ts = Date.now().toString();
  const hash = crypto.createHash("md5").update(ts + MARVEL_PRIVATE_KEY + MARVEL_PUBLIC_KEY).digest("hex");
  return `ts=${ts}&apikey=${MARVEL_PUBLIC_KEY}&hash=${hash}`;
}
async function marvelGet(path, params = "") {
  const url = `${BASE_URL}${path}?${marvelAuthParams()}${params ? "&" + params : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Marvel API ${res.status} sur ${path} : ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function coverFromThumbnail(comic) {
  const t = comic.thumbnail;
  if (!t || !t.path || t.path.includes("image_not_available")) return null;
  return `${t.path.replace(/^http:/, "https:")}/portrait_uncanny.${t.extension}`;
}

// Trouve la série Marvel la plus plausible pour un titre donné, en
// privilégiant celle dont la date de début est la plus proche de
// l'année qu'on a déjà en base pour ce titre.
async function findBestSeries(title, approxYear) {
  const res = await marvelGet("/series", `title=${encodeURIComponent(title)}&limit=20`);
  const results = res.data.results;
  if (!results.length) return null;
  if (!approxYear) return results[0];
  return results.reduce((best, s) => {
    const diff = Math.abs((s.startYear || 0) - approxYear);
    const bestDiff = Math.abs((best.startYear || 0) - approxYear);
    return diff < bestDiff ? s : best;
  }, results[0]);
}

async function enrichSeries(seriesTitle) {
  const { data: rows, error } = await supabase
    .from("issues")
    .select("id, number, year, cover_url")
    .eq("series_title", seriesTitle)
    .is("cover_url", null);
  if (error) throw error;
  if (!rows.length) {
    console.log(`"${seriesTitle}" : rien à compléter.`);
    return;
  }

  const approxYear = rows.find((r) => r.year)?.year || null;
  const marvelSeries = await findBestSeries(seriesTitle, approxYear);
  if (!marvelSeries) {
    console.log(`"${seriesTitle}" : aucune série trouvée côté Marvel, ignoré.`);
    return;
  }
  console.log(`"${seriesTitle}" → Marvel série #${marvelSeries.id} ("${marvelSeries.title}", ${marvelSeries.startYear})`);

  const wanted = new Set(rows.map((r) => r.number));
  let offset = 0, total = Infinity, found = 0;
  while (offset < total && found < wanted.size) {
    const page = await marvelGet(
      `/series/${marvelSeries.id}/comics`,
      `limit=100&offset=${offset}&orderBy=issueNumber&format=comic`
    );
    total = page.data.total;
    for (const comic of page.data.results) {
      if (!wanted.has(comic.issueNumber)) continue;
      const coverUrl = coverFromThumbnail(comic);
      if (!coverUrl) continue;
      const { error: updErr } = await supabase
        .from("issues")
        .update({ cover_url: coverUrl })
        .eq("series_title", seriesTitle)
        .eq("number", comic.issueNumber)
        .is("cover_url", null);
      if (updErr) console.error(`  erreur update #${comic.issueNumber} :`, updErr.message);
      else { found++; console.log(`  ✓ #${comic.issueNumber}`); }
    }
    offset += 100;
    await sleep(DELAY_MS);
  }
  console.log(`"${seriesTitle}" : ${found}/${wanted.size} couvertures trouvées.`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--series") ? args[args.indexOf("--series") + 1] : null;

  const { data: titles, error } = await supabase
    .from("issues")
    .select("series_title")
    .is("cover_url", null);
  if (error) throw error;

  const distinct = [...new Set(titles.map((t) => t.series_title))].filter((t) => !only || t === only);
  console.log(`${distinct.length} série(s) à traiter :`, distinct.join(", "));

  for (const title of distinct) {
    await enrichSeries(title);
    await sleep(DELAY_MS);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
