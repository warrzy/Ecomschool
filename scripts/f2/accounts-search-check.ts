/**
 * Lot F2-A — Tests de la recherche financière des élèves (lecture seule).
 *
 * Vérifie listAccounts() sur les données réelles : recherche par nom, prénom,
 * matricule, insensibilité casse/accents, combinaison avec les filtres,
 * isolation multi-établissements. Aucune écriture en base.
 *
 * Exécution : npx tsx scripts/f2/accounts-search-check.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { listAccounts } from "../../src/lib/services/finance/accounts";

let pass = 0;
let fail = 0;
let skip = 0;
const ok = (label: string) => { pass++; console.log(`PASS  ${label}`); };
const ko = (label: string, extra?: string) => {
  fail++;
  console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
};
const sk = (label: string, why: string) => {
  skip++;
  console.log(`SKIP  ${label} — ${why}`);
};
const check = (label: string, cond: boolean, extra?: string) =>
  cond ? ok(label) : ko(label, extra);

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

async function main() {
  // Cible : une école avec au moins un élève inscrit sur une année.
  const enrollment = await prisma.enrollment.findFirst({
    where: { status: "ENROLLED" },
    select: {
      schoolId: true,
      academicYearId: true,
      classroomId: true,
      student: {
        select: { id: true, matricule: true, firstName: true, lastName: true },
      },
      academicYear: { select: { name: true } },
    },
    orderBy: { student: { lastName: "asc" } },
  });
  if (!enrollment) {
    console.log("Aucune inscription ENROLLED en base — impossible de tester.");
    process.exit(1);
  }
  const ctx = { userId: "test", schoolId: enrollment.schoolId };
  const yearId = enrollment.academicYearId;
  const student = enrollment.student;
  console.log(
    `École ${enrollment.schoolId} · année ${enrollment.academicYear.name} · ` +
      `élève témoin ${student.firstName} ${student.lastName} (${student.matricule})`,
  );

  // 0. Baseline : sans recherche, l'élève est présent.
  const base = await listAccounts(ctx, { academicYearId: yearId });
  const inBase = base.find((a) => a.student.id === student.id);
  check("baseline : l'élève témoin figure dans la liste sans recherche", !!inBase);

  // 1. Recherche par nom exact.
  const byName = await listAccounts(ctx, {
    academicYearId: yearId,
    query: student.lastName,
  });
  check("recherche par nom", byName.some((a) => a.student.id === student.id));

  // 2. Recherche par prénom.
  const byFirst = await listAccounts(ctx, {
    academicYearId: yearId,
    query: student.firstName,
  });
  check("recherche par prénom", byFirst.some((a) => a.student.id === student.id));

  // 3. Recherche par matricule (préfixe partiel).
  const matPart = student.matricule.slice(0, Math.max(3, student.matricule.length - 2));
  const byMat = await listAccounts(ctx, {
    academicYearId: yearId,
    query: matPart,
  });
  check("recherche par matricule (partiel)", byMat.some((a) => a.student.id === student.id));

  // 4. Insensibilité à la casse.
  const byCase = await listAccounts(ctx, {
    academicYearId: yearId,
    query: student.lastName.toUpperCase(),
  });
  check("insensible à la casse (MAJUSCULES)", byCase.some((a) => a.student.id === student.id));

  // 5. Insensibilité aux accents — cherche un élève accentué dans la liste.
  const accented = base.find(
    (a) => norm(a.student.lastName) !== a.student.lastName.toLowerCase(),
  );
  if (accented) {
    const unaccentedQuery = norm(accented.student.lastName);
    const byAccent = await listAccounts(ctx, {
      academicYearId: yearId,
      query: unaccentedQuery,
    });
    check(
      `insensible aux accents (« ${unaccentedQuery} » → ${accented.student.lastName})`,
      byAccent.some((a) => a.student.id === accented.student.id),
    );
  } else {
    sk("insensible aux accents", "aucun élève accentué en base");
  }

  // 6. Recherche multi-mots « prénom nom ».
  const byFull = await listAccounts(ctx, {
    academicYearId: yearId,
    query: `${student.firstName} ${student.lastName}`,
  });
  check("recherche multi-mots (prénom + nom)", byFull.some((a) => a.student.id === student.id));

  // 7. Combinaison recherche + filtre classe.
  const byClass = await listAccounts(ctx, {
    academicYearId: yearId,
    classroomId: enrollment.classroomId,
    query: student.lastName,
  });
  check(
    "recherche + filtre classe combinés",
    byClass.some((a) => a.student.id === student.id),
  );
  const wrongClass = await prisma.classroom.findFirst({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: yearId,
      id: { not: enrollment.classroomId },
    },
    select: { id: true },
  });
  if (wrongClass) {
    const byWrong = await listAccounts(ctx, {
      academicYearId: yearId,
      classroomId: wrongClass.id,
      query: student.lastName,
    });
    check(
      "filtre classe restrictif exclut l'élève d'une autre classe",
      !byWrong.some((a) => a.student.id === student.id),
    );
  } else {
    sk("filtre classe restrictif", "une seule classe sur l'année");
  }

  // 8. Recherche sans résultat.
  const none = await listAccounts(ctx, {
    academicYearId: yearId,
    query: "zzzz-introuvable-999",
  });
  check("recherche sans correspondance → liste vide", none.length === 0);

  // 9. Isolation multi-établissements : le matricule de l'école A ne fuite pas
  //    dans le contexte d'une autre école.
  const other = await prisma.school.findFirst({
    where: { id: { not: ctx.schoolId } },
    select: { id: true, name: true },
  });
  if (other) {
    const otherYear = await prisma.academicYear.findFirst({
      where: { schoolId: other.id },
      select: { id: true },
    });
    if (otherYear) {
      const leak = await listAccounts(
        { userId: "test", schoolId: other.id },
        { academicYearId: otherYear.id, query: student.matricule },
      );
      check(
        `isolation : matricule ${student.matricule} invisible depuis ${other.name}`,
        !leak.some((a) => a.student.id === student.id),
      );
    } else {
      sk("isolation", "l'autre école n'a pas d'année scolaire");
    }
  } else {
    sk("isolation", "une seule école en base");
  }

  // 10. Recherche ne casse pas les agrégats (montants inchangés).
  if (inBase) {
    const inFiltered = byName.find((a) => a.student.id === student.id);
    check(
      "montants identiques avec/sans recherche",
      !!inFiltered &&
        inFiltered.charges === inBase.charges &&
        inFiltered.paid === inBase.paid &&
        inFiltered.balance === inBase.balance,
    );
  }

  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
