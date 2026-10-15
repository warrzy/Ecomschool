import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import {
  listSignupRequests,
  reviewSignupRequest,
  claimSignupRequestForConversion,
} from "@/lib/services/platform/signup-requests";

/**
 * Test du cycle de vie SchoolSignupRequest :
 * transitions de statut, conversion atomique, anti double-conversion.
 * Nettoie ses propres données (codes REQ-T-*).
 */

const TAG = `T${Date.now().toString(36)}`;
let pass = 0;
let fail = 0;

function check(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  OK   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
  }
}

async function mkRequest(status: "PENDING" | "CONTACTED" | "APPROVED" = "PENDING") {
  return prisma.schoolSignupRequest.create({
    data: {
      schoolName: `École Test ${TAG}`,
      contactName: "Contact Test",
      contactEmail: `contact-${TAG}@test.local`,
      status,
    },
  });
}

async function mkSchool(code: string) {
  return prisma.school.create({
    data: { name: `École Conv ${code}`, code, slug: code.toLowerCase() },
    select: { id: true },
  });
}

async function main() {
  const platformUser = await prisma.user.findFirst({
    where: { userRoles: { some: { role: { scope: "PLATFORM" } } } },
    select: { id: true },
  });
  if (!platformUser) throw new Error("Aucun utilisateur plateforme en base");
  const actor = platformUser.id;

  console.log(`== Transitions (${TAG}) ==`);

  const r1 = await mkRequest("PENDING");
  let res = await reviewSignupRequest(actor, { id: r1.id, action: "CONTACTED" });
  check(res.ok, "PENDING → CONTACTED");

  res = await reviewSignupRequest(actor, { id: r1.id, action: "CONTACTED" });
  check(!res.ok && res.error === "INVALID_STATE", "CONTACTED → CONTACTED refusé");

  res = await reviewSignupRequest(actor, { id: r1.id, action: "APPROVED" });
  check(res.ok, "CONTACTED → APPROVED");

  res = await reviewSignupRequest(actor, { id: r1.id, action: "CONTACTED" });
  check(!res.ok && res.error === "INVALID_STATE", "APPROVED → CONTACTED refusé");

  res = await reviewSignupRequest(actor, {
    id: crypto.randomUUID(),
    action: "APPROVED",
  });
  check(!res.ok && res.error === "NOT_FOUND", "id inconnu → NOT_FOUND");

  console.log("== Conversion atomique ==");
  const s1 = await mkSchool(`REQ-${TAG}-A`);
  const claimed = await prisma.$transaction(async (tx) =>
    claimSignupRequestForConversion(tx, r1.id, s1.id),
  );
  check(claimed === true, "claim APPROVED → CONVERTED");

  const after = await prisma.schoolSignupRequest.findUniqueOrThrow({
    where: { id: r1.id },
  });
  check(
    after.status === "CONVERTED" &&
      after.convertedSchoolId === s1.id &&
      !!after.convertedAt,
    "demande rattachée à l'école (convertedSchoolId)",
  );

  const s2 = await mkSchool(`REQ-${TAG}-B`);
  const reclaim = await prisma.$transaction(async (tx) =>
    claimSignupRequestForConversion(tx, r1.id, s2.id),
  );
  check(reclaim === false, "double conversion refusée (2ᵉ claim)");

  res = await reviewSignupRequest(actor, { id: r1.id, action: "REJECTED" });
  check(!res.ok && res.error === "INVALID_STATE", "CONVERTED → REJECTED refusé");

  console.log("== Rejet ==");
  const r2 = await mkRequest("PENDING");
  res = await reviewSignupRequest(actor, {
    id: r2.id,
    action: "REJECTED",
    note: "test rejet",
  });
  check(res.ok, "PENDING → REJECTED");

  const r2after = await prisma.schoolSignupRequest.findUniqueOrThrow({
    where: { id: r2.id },
  });
  check(
    r2after.reviewNote === "test rejet" && !!r2after.reviewedAt,
    "note de revue + reviewedAt enregistrés",
  );

  console.log("== Lecture ==");
  const pending = await listSignupRequests("PENDING");
  check(
    pending.every((r) => r.status === "PENDING"),
    "listSignupRequests filtre par statut",
  );

  const audits = await prisma.auditLog.count({
    where: { entity: "SchoolSignupRequest", entityId: r1.id },
  });
  check(audits >= 2, `audit trail présent (${audits} entrées)`);

  // Nettoyage — uniquement les données créées par ce test.
  await prisma.schoolSignupRequest.deleteMany({
    where: { contactEmail: { contains: TAG } },
  });
  await prisma.school.deleteMany({
    where: { code: { startsWith: `REQ-${TAG}` } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      entity: "SchoolSignupRequest",
      entityId: { in: [r1.id, r2.id] },
    },
  });

  console.log(`\n${pass} OK, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
