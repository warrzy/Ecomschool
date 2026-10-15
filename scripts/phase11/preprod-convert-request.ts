import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  reviewSignupRequest,
  claimSignupRequestForConversion,
} from "@/lib/services/platform/signup-requests";

/**
 * Recette préprod — revue + conversion contrôlée d'une demande d'inscription.
 * Rejoue exactement la transaction de l'action d'onboarding plateforme
 * (même chemin métier : école + année + périodes + admin + claim atomique).
 * Réservé aux bases autorisées (localhost uniquement).
 * Usage : ALLOW_DEMO_SEED=1 DEMO_SEED_ALLOWED_DBS=<db> \
 *   SIGNUP_REQUEST_SCHOOL="Lycée Horizon Recette (fictif)" \
 *   npx tsx scripts/phase11/preprod-convert-request.ts
 */

const SCHOOL_NAME = process.env.SIGNUP_REQUEST_SCHOOL;
if (!SCHOOL_NAME) {
  console.error("SIGNUP_REQUEST_SCHOOL manquant — arrêt.");
  process.exit(1);
}
if (process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusé : ALLOW_DEMO_SEED=1 requis.");
  process.exit(1);
}
const dbName = decodeURIComponent(
  new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, ""),
);
const allowed = (process.env.DEMO_SEED_ALLOWED_DBS ?? "").split(",").map((s) => s.trim());
if (!allowed.includes(dbName)) {
  console.error(`Refusé : base '${dbName}' non autorisée.`);
  process.exit(1);
}

async function main() {
  const req = await prisma.schoolSignupRequest.findFirst({
    where: { schoolName: SCHOOL_NAME },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, contactEmail: true, requestedPlan: { select: { code: true } } },
  });
  if (!req) throw new Error(`Demande introuvable : ${SCHOOL_NAME}`);
  console.log(`Demande ${req.id} — statut ${req.status}, plan ${req.requestedPlan?.code ?? "—"}`);

  const owner = await prisma.user.findFirstOrThrow({
    where: { userRoles: { some: { role: { name: "PLATFORM_OWNER" } } } },
    select: { id: true },
  });

  // Revue : PENDING → APPROVED (audit log écrit par le service).
  const review = await reviewSignupRequest(owner.id, {
    id: req.id,
    action: "APPROVED",
    note: "Recette préproduction — conversion contrôlée.",
  });
  if (!review.ok) throw new Error(`Revue échouée : ${review.error}`);
  console.log("Revue → APPROVED (audit enregistré)");

  // Conversion : même transaction que createSchoolOnboarding.
  const adminPassword = `Recette-${Math.random().toString(36).slice(2, 14)}`;
  const adminPasswordHash = await hashPassword(adminPassword);

  const result = await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: "Lycée Horizon Recette (fictif)",
        code: "LYC-RECETTE",
        slug: "lycee-horizon-recette",
        city: "Ouagadougou",
        phone: "+226 70 00 00 00",
        email: "contact@lycee-horizon-recette.test",
        country: "BF",
        currency: "XOF",
        timezone: "Africa/Ouagadougou",
        locale: "fr",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    const year = await tx.academicYear.create({
      data: {
        schoolId: school.id,
        name: "2025-2026",
        startDate: new Date("2025-10-01"),
        endDate: new Date("2026-06-30"),
        isCurrent: true,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    await tx.academicPeriod.createMany({
      data: [1, 2, 3].map((n) => ({
        academicYearId: year.id,
        schoolId: school.id,
        name: `Trimestre ${n}`,
        number: n,
        startDate: new Date("2025-10-01"),
        endDate: new Date("2026-06-30"),
        type: "TRIMESTER" as const,
      })),
    });

    const adminRole = await tx.role.findFirstOrThrow({
      where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
      select: { id: true },
    });

    const adminUser = await tx.user.create({
      data: {
        schoolId: school.id,
        email: "admin@lycee-horizon-recette.test",
        passwordHash: adminPasswordHash,
        firstName: "Admin",
        lastName: "Recette",
        status: "ACTIVE",
      },
      select: { id: true },
    });

    await tx.schoolMembership.create({
      data: {
        schoolId: school.id,
        userId: adminUser.id,
        roleId: adminRole.id,
        status: "ACTIVE",
      },
    });

    const claimed = await claimSignupRequestForConversion(tx, req.id, school.id);
    if (!claimed) throw new Error("REQUEST_ALREADY_CONVERTED");
    return { schoolId: school.id, adminUserId: adminUser.id };
  });

  const after = await prisma.schoolSignupRequest.findUniqueOrThrow({
    where: { id: req.id },
    select: { status: true, convertedSchoolId: true },
  });
  console.log(`Convertie : statut=${after.status} → école ${after.convertedSchoolId}`);
  console.log(`École créée : ${result.schoolId} (admin ${result.adminUserId})`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("CONVERSION ÉCHOUÉE:", e.message ?? e);
  process.exit(1);
});
