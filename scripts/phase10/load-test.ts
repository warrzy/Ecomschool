import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  ensureDevServer,
  killDevServer,
  signIn,
  httpRequest,
  resolveTestPort,
} from "../phase2/lib/test-utils";

/**
 * Test de charge mesuré — Phase 10.
 *
 * 1) Seed volumétrique dédié : école LOAD-TEST + 2 000 élèves + admin + abonnement.
 * 2) Mesures HTTP contre le serveur (next start recommandé) :
 *    - liste élèves paginée (pages 1/50/100), recherche plein-texte ;
 *    - export CSV complet ;
 *    - pages principales (dashboard, notifications, messagerie) ;
 *    - 20 requêtes concurrentes × 3 rounds ;
 *    - PDF collectif des bulletins (école démo).
 * 3) Rapport p50 / p95 / max par scénario.
 */

const STUDENT_COUNT = 2000;
const SCHOOL_CODE = "LOAD-TEST";
const ADMIN_EMAIL = "load-admin@ecom-test.local";
const ADMIN_PASSWORD = process.env.SEED_TEST_PASSWORD ?? "LoadTest2026!";

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

async function timed(jar: Record<string, string>, base: string, path: string) {
  const t0 = performance.now();
  const res = await httpRequest(
    `${base}${path}`,
    { method: "GET" },
    jar,
  );
  const ms = performance.now() - t0;
  return { ms, status: res.status, bytes: res.body.length };
}

async function main() {
  // ---------- 1) Seed volumétrique ----------
  console.log("== Seed volumétrique ==");
  const tSeed = performance.now();

  let school = await prisma.school.findUnique({ where: { code: SCHOOL_CODE } });
  if (!school) {
    school = await prisma.school.create({
      data: { name: "Ecole Test de Charge", code: SCHOOL_CODE, slug: "load-test" },
    });
  }

  const role = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
  });

  let admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        firstName: "Load",
        lastName: "Admin",
      },
    });
  }
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId: school.id, userId: admin.id } },
    create: { schoolId: school.id, userId: admin.id, roleId: role.id },
    update: { status: "ACTIVE" },
  });

  // Pas d'abonnement → tous les modules couverts (comportement
  // `isPermissionCoveredBySubscription` : pas de restriction sans souscription).

  // Élèves en masse (createMany par lots).
  const current = await prisma.student.count({ where: { schoolId: school.id } });
  const toCreate = Math.max(0, STUDENT_COUNT - current);
  for (let i = 0; i < toCreate; i += 500) {
    const batch = Array.from(
      { length: Math.min(500, toCreate - i) },
      (_, j) => ({
        schoolId: school!.id,
        matricule: `LT-${String(current + i + j + 1).padStart(5, "0")}`,
        firstName: `Prenom${current + i + j}`,
        lastName: `Nom${(current + i + j) % 97}-${current + i + j}`,
        sex: (i + j) % 2 === 0 ? "MALE" as const : "FEMALE" as const,
      }),
    );
    await prisma.student.createMany({ data: batch });
  }
  const totalStudents = await prisma.student.count({
    where: { schoolId: school.id },
  });
  console.log(
    `École ${school.code} : ${totalStudents} élèves (seed ${(performance.now() - tSeed).toFixed(0)} ms)\n`,
  );

  // ---------- 2) Serveur + session ----------
  const port = resolveTestPort();
  const { child, baseUrl } = await ensureDevServer(port);
  console.log(`Serveur : ${baseUrl}\n`);

  try {
    const { jar } = await signIn({
      baseUrl,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    // La session est dans le jar (cookie next-auth). Un premier appel pour
    // valider que la connexion a réussi.
    const probe = await timed(jar, baseUrl, "/app");
    if (probe.status === 307 || probe.status === 302) {
      throw new Error(`Login échoué (redirection ${probe.status})`);
    }

    const results: { name: string; samples: number[]; status: number; bytes: number }[] = [];

    async function scenario(name: string, path: string, rounds = 5) {
      const samples: number[] = [];
      let status = 0;
      let bytes = 0;
      for (let i = 0; i < rounds; i++) {
        const r = await timed(jar, baseUrl, path);
        samples.push(r.ms);
        status = r.status;
        bytes = r.bytes;
      }
      results.push({ name, samples, status, bytes });
    }

    console.log("== Mesures séquentielles ==");
    await scenario("GET /app (dashboard)", "/app");
    await scenario("GET /app/students p1", "/app/students?page=1");
    await scenario("GET /app/students p50", "/app/students?page=50");
    await scenario("GET /app/students p100", "/app/students?page=100");
    await scenario("GET /app/students recherche", "/app/students?q=Nom42");
    await scenario("GET /app/students/export CSV", "/app/students/export", 3);
    await scenario("GET /app/notifications", "/app/notifications");
    await scenario("GET /app/messages", "/app/messages");
    await scenario("GET /app/fees", "/app/fees");

    console.log("== Concurrence : 20 requêtes parallèles × 3 rounds ==");
    {
      const samples: number[] = [];
      let status = 0;
      for (let round = 0; round < 3; round++) {
        const batch = await Promise.all(
          Array.from({ length: 20 }, () =>
            timed(jar, baseUrl, "/app/students?page=1"),
          ),
        );
        for (const b of batch) {
          samples.push(b.ms);
          status = b.status;
        }
      }
      results.push({
        name: "GET /app/students p1 ×20 conc.",
        samples,
        status,
        bytes: 0,
      });
    }

    // PDF collectif sur l'école démo (bulletins existants).
    console.log("== PDF collectif ==");
    const demo = await signIn({
      baseUrl,
      email: "admin@demo.local",
      password: process.env.SEED_DEMO_PASSWORD ?? "Demo2026!",
    });
    {
      const samples: number[] = [];
      let status = 0;
      let bytes = 0;
      for (let i = 0; i < 3; i++) {
        const r = await timed(demo.jar, baseUrl, "/app/report-cards/pdf");
        samples.push(r.ms);
        status = r.status;
        bytes = r.bytes;
      }
      results.push({ name: "GET /app/report-cards/pdf (tous)", samples, status, bytes });
    }

    // ---------- 3) Rapport ----------
    console.log("\n== RÉSULTATS ==\n");
    console.log(
      "| Scénario | statut | taille | p50 | p95 | max |",
    );
    console.log("|---|---|---|---|---|---|");
    for (const r of results) {
      const s = [...r.samples].sort((a, b) => a - b);
      console.log(
        `| ${r.name} | ${r.status} | ${(r.bytes / 1024).toFixed(1)} Ko | ${percentile(s, 50).toFixed(0)} ms | ${percentile(s, 95).toFixed(0)} ms | ${s[s.length - 1]?.toFixed(0)} ms |`,
      );
    }
    const mem = process.memoryUsage();
    console.log(
      `\nMémoire process mesure : heap ${(mem.heapUsed / 1048576).toFixed(0)} Mo`,
    );
  } finally {
    await killDevServer(child);
  }
}

main()
  .catch((e) => {
    console.error("ÉCHEC:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
