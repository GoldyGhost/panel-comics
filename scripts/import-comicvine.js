// ============================================================
// scripts/import-comicvine.js
//
// Importe des comics depuis l'API Comic Vine (comicvine.gamespot.com)
// dans la table `issues` de Supabase. Remplace scripts/import-marvel.js
// depuis la fermeture du portail développeur Marvel (29 octobre 2025,
// plus aucune nouvelle inscription possible).
//
// Comic Vine référence tous les éditeurs (pas seulement Marvel) : on
// filtre par éditeur pour rester sur des comics Marvel si besoin.
//
// Nécessite Node.js 18+ et les variables listées dans .env.example
// (COMICVINE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// Usage :
//   node scripts/import-comicvine.js --title "Amazing Spider-Man"
//   node scripts/import-comicvine.js --volume 2005      (id de volume Comic Vine précis)
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
const PAGE_LIMIT = 100;
const DELAY_MS = 1000; // Comic Vine limite le débit par heure : on reste prudent

// Comic Vine exige un User-Agent identifiable, sinon il renvoie une erreur 420.
// Remplace l'email par le tien (pas obligatoire que ce soit fonctionnel, mais
// recommandé par leurs conditions d'utilisation).
const HEADERS = { "User-Agent": "PANEL-comics-log/1.0 (contact: ton-email@example.com)" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cvGet(path, params = "") {
  const url = `${BASE_URL}${path}?api_key=${COMICVINE_API_KEY}&format=json${params ? "&" + params : ""}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Comic Vine ${res.status} sur ${path} : ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.status_code !== 1) {
    throw new Error(`Comic Vine erreur "${json.error}" sur ${path}`);
  }
  return json;
}

function pickRole(personCredits, keywords) {
  if (!personCredits) return null;
  const hit = personCredits.find((p) => keywords.some((k) => (p.role || "").toLowerCase().includes(k)));
  return hit?.name || null;
}

function toIssueRow(issue, seriesTitle, volumeId) {
  const writer = pickRole(issue.person_credits, ["writer", "script"]);
  const artist = pickRole(issue.person_credits, ["penciler", "artist", "penciller"]);
  const year = issue.cover_date ? issue.cover_date.slice(0, 4) : null;
  return {
    id: `cv-${issue.id}`,
    series_id: `cvvol-${volumeId}`,
    series_title: seriesTitle,
    color: "#1E3A8A",
    run_name: null,
    arc_name: issue.name || null,
    number: parseFloat(issue.issue_number) || 0,
    year: year ? parseInt(year, 10) : null,
    writer,
    artist,
    cover_url: issue.image?.original_url || issue.image?.medium_url || null,
    custom: false,
  };
}

async function upsertIssues(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from("issues").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`  → ${rows.length} issues synchronisées`);
}

// Récupère le détail d'une issue (nécessaire pour avoir les rôles des
// créateurs — les listes paginées ne donnent que le nom, sans le rôle).
async function fetchIssueDetail(issueId) {
  const json = await cvGet(`/issue/4000-${issueId}/`, "field_list=id,issue_number,name,cover_date,image,person_credits");
  return json.results;
}

async function importVolume(volumeId, seriesTitleOverride) {
  const volInfo = await cvGet(`/volume/4050-${volumeId}/`, "field_list=id,name,start_year,publisher");
  const seriesTitle = seriesTitleOverride || volInfo.results.name;
  console.log(`Import de "${seriesTitle}" (volume ${volumeId})…`);

  let offset = 0, total = Infinity, rows = [];
  while (offset < total) {
    const page = await cvGet(
      "/issues/",
      `filter=volume:${volumeId}&limit=${PAGE_LIMIT}&offset=${offset}&sort=issue_number:asc&field_list=id,issue_number`
    );
    total = page.number_of_total_results;
    for (const light of page.results) {
      await sleep(DELAY_MS);
      const full = await fetchIssueDetail(light.id);
      rows.push(toIssueRow(full, seriesTitle, volumeId));
      if (rows.length >= 20) { await upsertIssues(rows); rows = []; }
    }
    offset += PAGE_LIMIT;
  }
  await upsertIssues(rows);
}

async function importByTitle(title) {
  const res = await cvGet("/search/", `resources=volume&query=${encodeURIComponent(title)}&field_list=id,name,start_year,publisher&limit=10`);
  if (!res.results.length) {
    console.error(`Aucune série trouvée pour "${title}"`);
    return;
  }
  const marvelResults = res.results.filter((v) => v.publisher?.name === "Marvel");
  const candidates = marvelResults.length ? marvelResults : res.results;
  console.log(`${candidates.length} correspondance(s) pour "${title}" :`);
  candidates.forEach((v) => console.log(`  - volume ${v.id} : "${v.name}" (${v.start_year}, ${v.publisher?.name || "éditeur inconnu"})`));
  // Importe la première correspondance Marvel (ou la première tout court à défaut).
  await importVolume(candidates[0].id, candidates[0].name);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--volume")) {
    await importVolume(args[args.indexOf("--volume") + 1]);
  } else if (args.includes("--title")) {
    await importByTitle(args[args.indexOf("--title") + 1]);
  } else {
    console.log('Usage : node scripts/import-comicvine.js --title "Amazing Spider-Man"');
    console.log("        node scripts/import-comicvine.js --volume 2005");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

// ============================================================
// NOTES :
// 1. Comic Vine limite le nombre de requêtes par heure (vérifie le
//    chiffre actuel sur ton compte comicvine.gamespot.com/api/) — ce
//    script fait UNE requête détaillée par issue (pour les crédits),
//    donc une série de 100 numéros = ~100 requêtes. Importe par lots
//    plutôt que --all sur tout un catalogue.
// 2. Comic Vine couvre tous les éditeurs : le filtre "Marvel" n'est
//    appliqué qu'à la recherche par titre (--title), pas par --volume
//    où tu donnes directement l'id exact.
// 3. Comme pour Marvel, `run_name` (notion de run éditorial) n'existe
//    pas dans Comic Vine : laissé vide, à compléter à la main si besoin.
// ============================================================
