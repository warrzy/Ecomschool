import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Test de restauration isolé — Phase 10.
 *
 * 1) pg_dump -Fc de la base source (DATABASE_URL).
 * 2) createdb ecomschool_restore_test (isolée).
 * 3) pg_restore dans la base de test.
 * 4) Comparaison des comptages sur tables critiques (source vs restauration).
 * 5) dropdb de la base de test.
 *
 * Usage : npx tsx scripts/phase10/backup-restore-test.ts
 * Prérequis : binaires PostgreSQL (pg_dump/pg_restore/createdb/dropdb).
 */

const PG_BIN = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";
const RESTORE_DB = "ecomschool_restore_test";
const TABLES = [
  "School",
  "User",
  "SchoolMembership",
  "Student",
  "Enrollment",
  "Grade",
  "ReportCard",
  "Payment",
  "Notification",
  "Job",
  "MessageDelivery",
  "AuditLog",
];

const url = new URL(process.env.DATABASE_URL!);
const env = {
  ...process.env,
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
};
const SOURCE_DB = url.pathname.slice(1);

function bin(name: string) {
  const p = path.join(PG_BIN, `${name}.exe`);
  if (!existsSync(p)) throw new Error(`${name} introuvable : ${p}`);
  return p;
}

async function counts(db: string) {
  const client = new pg.Client({
    user: env.PGUSER,
    password: env.PGPASSWORD,
    host: env.PGHOST,
    port: Number(env.PGPORT),
    database: db,
  });
  await client.connect();
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    out[t] = r.rows[0].n;
  }
  await client.end();
  return out;
}

async function main() {
  mkdirSync("backups/test", { recursive: true });
  const dump = path.join(
    "backups/test",
    `${SOURCE_DB}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.dump`,
  );

  console.log(`1) pg_dump ${SOURCE_DB} → ${dump}`);
  execFileSync(bin("pg_dump"), ["-Fc", "-f", dump, SOURCE_DB], {
    env,
    stdio: "inherit",
  });
  console.log(`   taille : ${(statSync(dump).size / 1048576).toFixed(1)} Mo`);

  console.log(`2) création base isolée ${RESTORE_DB}`);
  execFileSync(bin("dropdb"), ["--if-exists", RESTORE_DB], {
    env,
    stdio: "inherit",
  });
  execFileSync(bin("createdb"), [RESTORE_DB], { env, stdio: "inherit" });

  console.log("3) pg_restore");
  execFileSync(bin("pg_restore"), ["-d", RESTORE_DB, dump], {
    env,
    stdio: "inherit",
  });

  console.log("4) comparaison des comptages");
  const [src, dst] = await Promise.all([counts(SOURCE_DB), counts(RESTORE_DB)]);
  let ok = true;
  for (const t of TABLES) {
    const match = src[t] === dst[t];
    if (!match) ok = false;
    console.log(
      `   ${match ? "✓" : "✗"} ${t}: source=${src[t]} restauration=${dst[t]}`,
    );
  }

  console.log(`5) suppression ${RESTORE_DB}`);
  execFileSync(bin("dropdb"), [RESTORE_DB], { env, stdio: "inherit" });

  if (!ok) throw new Error("Comptages divergents après restauration");
  console.log("\n✓ Restauration validée : comptages identiques.");
}

main().catch((e) => {
  console.error("ÉCHEC:", e.message ?? e);
  process.exit(1);
});
