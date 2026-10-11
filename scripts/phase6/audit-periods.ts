import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

/**
 * Audit non destructif des périodes scolaires (Étape 0 — Phase 6).
 *
 * Détecte les périodes héritées du bug pré-Phase 5 (toutes les périodes
 * couvraient l'année entière au lieu de tranches distinctes).
 *
 * --report (défaut) : liste les chevauchements et signale les périodes
 *   dont des résultats/bulletins existent (données verrouillées).
 * --fix : redécoupe UNIQUEMENT les années où aucune donnée verrouillée
 *   (résultat VALIDATED/PUBLISHED/RECTIFIED ou bulletin) n'existe.
 *   Jamais de recalcul ni de mutation de résultats validés.
 */

const FIX = process.argv.includes("--fix");

function overlaps(
  periods: { id: string; startDate: Date; endDate: Date }[],
) {
  const sorted = [...periods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const bad: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].endDate >= sorted[i + 1].startDate) bad.push(sorted[i].id);
  }
  return bad;
}

async function main() {
  const years = await prisma.academicYear.findMany({
    include: {
      periods: { orderBy: { number: "asc" } },
      school: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let affected = 0;
  let fixed = 0;
  let locked = 0;

  for (const year of years) {
    if (year.periods.length === 0) continue;
    const bad = overlaps(year.periods);
    if (bad.length === 0) continue;
    affected++;

    // Périodes « verrouillées » : résultats validés/publiés ou bulletins.
    const [resultsCount, cardsCount] = await Promise.all([
      prisma.studentPeriodResult.count({
        where: {
          academicPeriodId: { in: year.periods.map((p) => p.id) },
          status: { in: ["VALIDATED", "PUBLISHED", "RECTIFIED"] },
        },
      }),
      prisma.reportCard.count({
        where: { academicPeriodId: { in: year.periods.map((p) => p.id) } },
      }),
    ]);
    const isLocked = resultsCount > 0 || cardsCount > 0;
    if (isLocked) locked++;

    console.log(
      `${isLocked ? "🔒" : "⚠️ "} ${year.school.name} — ${year.name} (${year.periods[0]?.type}) : ` +
        `${bad.length} chevauchement(s), ${resultsCount} résultat(s) verrouillé(s), ${cardsCount} bulletin(s)`,
    );

    if (FIX && !isLocked) {
      const start = year.startDate;
      const end = year.endDate;
      const slice = (end.getTime() - start.getTime()) / year.periods.length;
      for (let i = 0; i < year.periods.length; i++) {
        const p = year.periods[i];
        const newStart = new Date(start.getTime() + Math.floor(slice * i));
        const newEnd =
          i === year.periods.length - 1
            ? end
            : new Date(start.getTime() + Math.floor(slice * (i + 1)) - 1);
        await prisma.academicPeriod.update({
          where: { id: p.id },
          data: { startDate: newStart, endDate: newEnd },
        });
      }
      console.log(`   ✅ redécoupé en ${year.periods.length} tranches`);
      fixed++;
    } else if (isLocked) {
      console.log("   → non modifié (données verrouillées : correction manuelle requise)");
    }
  }

  console.log(
    JSON.stringify({ years: years.length, affected, locked, fixed, mode: FIX ? "fix" : "report" }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
