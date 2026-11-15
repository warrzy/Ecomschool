/**
 * I18N-P0 — Backfill des clés sémantiques PAYROLL:* pour les écoles
 * dont le plan comptable a été installé avant leur introduction.
 * Idempotent (upsert par [schoolId, key]) ; n'écrase jamais un mapping
 * existant (update: {}) ; n'invente pas de compte : une clé n'est posée
 * que si le compte cible existe dans le plan de l'école.
 *
 * Usage : ALLOW_RECETTE=1 tsx scripts/i18n/backfill-payroll-maps.ts
 */
import { prisma } from "../../src/lib/db/prisma";
import { assertRecetteEnv } from "../lib/recette-guard";

const KEYS: { key: string; codes: string[] }[] = [
  { key: "PAYROLL:EXPENSE", codes: ["66"] },
  { key: "PAYROLL:PAYABLE", codes: ["422"] },
  { key: "PAYROLL:SOCIAL", codes: ["431"] },
  { key: "PAYROLL:ADVANCES", codes: ["421", "425"] },
];

async function main() {
  assertRecetteEnv("backfill-payroll-maps");
  const schools = await prisma.school.findMany({ select: { id: true, code: true } });
  let created = 0;
  for (const s of schools) {
    const journal = await prisma.accountingJournal.findFirst({
      where: { schoolId: s.id, code: "OD" }, select: { id: true },
    });
    for (const { key, codes } of KEYS) {
      const account = await prisma.accountingAccount.findFirst({
        where: { schoolId: s.id, code: { in: codes }, status: "ACTIVE" },
        orderBy: { code: "asc" }, select: { id: true },
      });
      if (!account) continue; // pas de compte cible → rien à mapper
      const r = await prisma.accountingAccountMap.upsert({
        where: { schoolId_key: { schoolId: s.id, key } },
        create: { schoolId: s.id, key, accountId: account.id, journalId: journal?.id ?? null },
        update: {},
      });
      if (r) created++;
    }
  }
  console.log(`${schools.length} écoles inspectées — ${created} clés PAYROLL:* présentes`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
