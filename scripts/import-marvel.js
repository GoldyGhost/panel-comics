// ============================================================
// scripts/import-marvel.js
// ⚠️ Le portail développeur Marvel a fermé le 29/10/2025 (plus de nouvelles inscriptions).
// Utilise plutôt scripts/import-comicvine.js — ce fichier est gardé au cas où Marvel rouvrirait.
//
// Importe le catalogue Marvel (séries + issues) depuis l'API
// officielle Marvel (https://developer.marvel.com) dans la table
// `issues` de Supabase. À exécuter en local ou via une tâche
// planifiée (ce n'est PAS un script à mettre dans le front).
//
// Nécessite Node.js 18+ (fetch natif) et les variables d'env
// listées dans .env.example.
//
// Usage :
//   node scripts/import-marvel.js --series 1009610   (une série précise)
//   node scripts/import-marvel.js --title "Amazing Spider-Man"
//   node scripts/import-marvel.js --all                (TOUTES les séries — long, voir notes en bas)
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

// La clé service_role donne un accès complet, en contournant les
// policies RLS : elle ne doit JAMAIS être envoyée au navigateur,
// seulement utilisée ici, côté serveur/local.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BASE_URL = "https://gateway.marvel.com/v1/public";
const PAGE_LIMIT = 100;          // maximum autorisé par l'API Marvel
const DELAY_MS = 400;            // pause entre deux appels pour rester sous les quotas

function marvelAuthParams() {
  const ts = Date.now().toString();
  const hash = crypto
    .createHash("md5")
    .update(ts + MARVEL_PRIVATE_KEY + MARVEL_PUBLIC_KEY)
    .digest("hex");
  return `ts=${ts}&apikey=${MARVEL_PUBLIC_KEY}&hash=${hash}`;
}

async function marvelGet(path, params = "") {
  const url = `${BASE_URL}${path}?${marvelAuthParams()}${params ? "&" + params : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Marvel API ${res.status} sur ${path} : ${body.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function findCreator(comic, roleKeywords) {
  const items = comic.creators?.items || [];
  const hit = items.find((c) => roleKeywords.some((k) => c.role?.toLowerCase().includes(k)));
  return hit?.name || null;
}

// Marvel renvoie une image "cassée" (image_not_available) pour beaucoup
// d'anciens numéros : on la filtre pour garder le fallback coloré du site.
function coverFromThumbnail(comic) {
  const t = comic.thumbnail;
  if (!t || !t.path || t.path.includes("image_not_available")) return null;
  // "portrait_uncanny" = un format vertical proche d'une vraie couverture (~300x450)
  return `${t.path.replace(/^http:/, "https:")}/portrait_uncanny.${t.extension}`;
}

// Transforme un "comic" renvoyé par Marvel en ligne pour la table `issues`.
function toIssueRow(comic, seriesTitle, seriesId) {
  const writer = findCreator(comic, ["writer"]);
  const artist = findCreator(comic, ["penciler", "artist", "cover artist"]);
  const year = comic.dates?.find((d) => d.type === "onsaleDate")?.date?.slice(0, 4) || null;
  return {
    id: `marvel-${comic.id}`,
    series_id: `mseries-${seriesId}`,
    series_title: seriesTitle,
    color: "#1E3A8A",
    run_name: null,                 // Marvel ne fournit pas la notion de "run" éditorial — voir note en bas
    arc_name: comic.title?.replace(seriesTitle, "").trim() || null,
    number: comic.issueNumber ?? 0,
    year: year ? parseInt(year, 10) : null,
    writer,
    artist,
    cover_url: coverFromThumbnail(comic),
    custom: false,
  };
}

async function upsertIssues(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from("issues").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`  → ${rows.length} issues synchronisées`);
}

// Importe toutes les issues d'UNE série (par son id Marvel).
async function importSeries(seriesId) {
  const seriesInfo = await marvelGet(`/series/${seriesId}`);
  const seriesTitle = seriesInfo.data.results[0]?.title || `Série ${seriesId}`;
  console.log(`Import de "${seriesTitle}" (id ${seriesId})…`);

  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await marvelGet(
      `/series/${seriesId}/comics`,
      `limit=${PAGE_LIMIT}&offset=${offset}&orderBy=issueNumber&format=comic`
    );
    total = page.data.total;
    const rows = page.data.results.map((c) => toIssueRow(c, seriesTitle, seriesId));
    await upsertIssues(rows);
    offset += PAGE_LIMIT;
    await sleep(DELAY_MS);
  }
}

// Cherche une série par titre approximatif puis l'importe.
async function importByTitle(title) {
  const res = await marvelGet("/series", `title=${encodeURIComponent(title)}&limit=10`);
  if (!res.data.results.length) {
    console.error(`Aucune série trouvée pour "${title}"`);
    return;
  }
  for (const s of res.data.results) {
    await importSeries(s.id);
  }
}

// Importe TOUTES les séries Marvel — très long (des dizaines de milliers
// d'issues), voir les notes de limitation en bas du fichier avant de lancer.
async function importAll() {
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await marvelGet("/series", `limit=${PAGE_LIMIT}&offset=${offset}`);
    total = page.data.total;
    for (const s of page.data.results) {
      await importSeries(s.id);
    }
    offset += PAGE_LIMIT;
    await sleep(DELAY_MS);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    await importAll();
  } else if (args.includes("--series")) {
    const id = args[args.indexOf("--series") + 1];
    await importSeries(id);
  } else if (args.includes("--title")) {
    const title = args[args.indexOf("--title") + 1];
    await importByTitle(title);
  } else {
    console.log("Usage : node scripts/import-marvel.js --title \"Amazing Spider-Man\"");
    console.log("        node scripts/import-marvel.js --series 1009610");
    console.log("        node scripts/import-marvel.js --all   (déconseillé sans lire les notes du fichier)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ============================================================
// NOTES IMPORTANTES avant d'utiliser --all :
//
// 1. Le plan développeur gratuit de Marvel limite le nombre d'appels
//    par jour (vérifie le chiffre actuel sur developer.marvel.com,
//    il a changé plusieurs fois par le passé). Le catalogue complet
//    représente des dizaines de milliers de comics et de très
//    nombreux appels paginés : --all peut prendre plusieurs jours
//    à cause de cette limite, pas seulement du DELAY_MS ci-dessus.
//
// 2. Marvel ne fournit pas la notion de "run" éditorial (ex. "Lee &
//    Ditko") ni d'"arc de lecture" comme ce projet les utilise :
//    seulement titre de série + numéro + créateurs + date. Le champ
//    `run_name` reste donc vide pour les imports Marvel — tu peux le
//    compléter à la main plus tard, ou l'ignorer.
//
// 3. Le nom et le logo "Marvel", ainsi que les couvertures et
//    synopsis, restent la propriété de Marvel : les conditions
//    d'utilisation de leur API (developer.marvel.com/terms)
//    encadrent ce que tu as le droit d'afficher publiquement,
//    notamment si l'app devient publique/commerciale. À lire avant
//    de rendre le site accessible à d'autres personnes.
// ============================================================
