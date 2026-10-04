// ============================================================
// scripts/gcd-inspect.js
//
// Reads the GCD SQLite dump (read-only, nothing is modified or sent
// anywhere) and writes a small text file "gcd-schema.txt" containing,
// for every table: its row count, its CREATE statement and 2 sample rows
// (long values truncated). That file is all that's needed to plan the
// import — the multi-GB dump itself never has to be shared.
//
// Usage (Node 22.5+ / 24, no extra install):
//   node scripts/gcd-inspect.js "C:\path\to\gcd-dump.db"
// ============================================================

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path || !fs.existsSync(path)) {
  console.error('Usage: node scripts/gcd-inspect.js "C:\\path\\to\\gcd-dump.db"');
  process.exit(1);
}

const db = new DatabaseSync(path);
const objects = db
  .prepare("select name, type, sql from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name")
  .all();

const clip = (v) => {
  if (v === null || v === undefined) return "NULL";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
};

let out = `# GCD dump: ${path}\n# ${objects.length} tables/views\n\n`;
let i = 0;
for (const o of objects) {
  i++;
  process.stdout.write(`\r${i}/${objects.length} ${o.name}                    `);
  let count = "?";
  try { count = db.prepare(`select count(*) as c from "${o.name}"`).get().c; } catch { /* view or unreadable */ }
  out += `## ${o.name} [${o.type}] — ${count} rows\n${o.sql}\n`;
  try {
    const sample = db.prepare(`select * from "${o.name}" limit 2`).all();
    for (const row of sample) {
      out += "  sample: " + Object.entries(row).map(([k, v]) => `${k}=${clip(v)}`).join(" | ") + "\n";
    }
  } catch { /* ignore */ }
  out += "\n";
}
fs.writeFileSync("gcd-schema.txt", out, "utf-8");
console.log(`\nDone → gcd-schema.txt (${(out.length / 1024).toFixed(0)} KB)`);
