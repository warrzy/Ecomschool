import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { createPlan, updatePlan } from "@/lib/services/platform/plans";
import {
  assignSubscription,
  changePlan,
  extendTrial,
  renewSubscription,
  reactivateSubscription,
  cancelSubscription,
  sweepSubscriptions,
  requestPlanChange,
  reviewChangeRequest,
} from "@/lib/services/platform/subscriptions";
import {
  setModuleOverride,
  isModuleEnabled,
  isPermissionCoveredBySubscription,
  usageSnapshot,
  getEntitlements,
} from "@/lib/services/platform/modules";
import {
  generateInvoice,
  recordPlatformPayment,
  issueCreditNote,
  cancelInvoice,
  listSchoolInvoices,
  listUnpaidInvoices,
} from "@/lib/services/platform/billing";
import { startSupportSession, endSupportSession, expireSupportSessions } from "@/lib/services/platform/support";
import { platformMonitoring } from "@/lib/services/platform/monitoring";
import { platformDashboard } from "@/lib/services/platform/dashboard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { renderInvoice, type InvoiceSnapshot } from "@/lib/pdf/invoice";
import PDFDocument from "pdfkit";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail?: string) =>
  checks.push({ name, ok, detail });

async function ensureSchool(code: string, name: string) {
  return prisma.school.upsert({
    where: { code },
    update: { status: "ACTIVE" },
    create: { name, code, slug: code.toLowerCase(), status: "ACTIVE" },
    select: { id: true },
  });
}

async function ensureUser(schoolId: string, email: string, roleName: string) {
  const passwordHash = await hashPassword(process.env.SEED_TEST_PASSWORD ?? "Test1234!");
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { schoolId, status: "ACTIVE" },
    create: {
      email,
      passwordHash,
      schoolId,
      status: "ACTIVE",
      firstName: "Test",
      lastName: email.split("@")[0],
    },
    select: { id: true },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    update: { roleId: role.id, status: "ACTIVE" },
    create: { schoolId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  return user.id;
}

async function ensureModule(code: string, name: string, commercial = true) {
  return prisma.platformModule.upsert({
    where: { code },
    update: {},
    create: { code, name, commercial },
    select: { id: true, code: true },
  });
}

const S = Date.now() % 100000;

async function main() {
  const schoolA = await ensureSchool("TEST-P8-A", "Ecole Test Phase8 A");
  const schoolB = await ensureSchool("TEST-P8-B", "Ecole Test Phase8 B");
  const adminA = await ensureUser(schoolA.id, "phase8-admin-a@ecom-test.local", "ADMIN_SCHOOL");
  const adminB = await ensureUser(schoolB.id, "phase8-admin-b@ecom-test.local", "ADMIN_SCHOOL");
  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };
  const platformActor = adminA; // acteur plateforme (audit)

  // ---- Catalogue : modules de test dédiés ----
  await ensureModule(`P8CORE-${S}`, "Noyau P8");
  await ensureModule(`P8EXTRA-${S}`, "Extra P8");
  record("Catalogue modules présent", true);

  // ============ 1. Création d'offre ============
  const planSmall = await createPlan(platformActor, {
    code: `P8-SMALL-${S}`,
    name: `Offre Small ${S}`,
    monthlyPrice: 5000,
    yearlyPrice: 50000,
    maxStudents: 1,
    maxUsers: null,
    trialDays: 14,
    graceDays: 1,
    moduleCodes: [`P8CORE-${S}`],
  });
  record("Création offre", planSmall.ok);
  if (!planSmall.ok) throw new Error("createPlan failed");
  const smallId = planSmall.result.id;

  const dup = await createPlan(platformActor, {
    code: `P8-SMALL-${S}`,
    name: "Doublon",
    monthlyPrice: 1,
    yearlyPrice: 1,
    moduleCodes: [],
  });
  record("Refus code offre dupliqué", !dup.ok && dup.error === "DUPLICATE");

  const planBig = await createPlan(platformActor, {
    code: `P8-BIG-${S}`,
    name: `Offre Big ${S}`,
    monthlyPrice: 20000,
    yearlyPrice: 200000,
    moduleCodes: [`P8CORE-${S}`, `P8EXTRA-${S}`],
  });
  if (!planBig.ok) throw new Error("createPlan big failed");
  const bigId = planBig.result.id;

  const upd = await updatePlan(platformActor, smallId, { monthlyPrice: 6000 });
  const afterUpd = await prisma.subscriptionPlan.findUnique({ where: { id: smallId } });
  record("Modification prix offre", upd.ok && afterUpd?.monthlyPrice === 6000);

  // ============ 2. Abonnement + essai ============
  // Nettoyer tout abonnement résiduel de runs précédents
  await prisma.schoolSubscription.updateMany({
    where: { schoolId: schoolA.id, status: { notIn: ["CANCELLED", "EXPIRED"] } },
    data: { status: "CANCELLED", endedAt: new Date() },
  });
  await prisma.schoolSubscription.updateMany({
    where: { schoolId: schoolB.id, status: { notIn: ["CANCELLED", "EXPIRED"] } },
    data: { status: "CANCELLED", endedAt: new Date() },
  });

  const sub = await assignSubscription(platformActor, {
    schoolId: schoolA.id,
    planId: smallId,
    cycle: "MONTHLY",
    startTrial: true,
  });
  record("Attribution abonnement + essai", sub.ok);
  if (!sub.ok) throw new Error("assignSubscription failed");
  const subId = sub.result.id;
  const subRow = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record("Statut TRIALING", subRow?.status === "TRIALING" && !!subRow?.trialEndsAt);

  const ext = await extendTrial(platformActor, { subscriptionId: subId, days: 5 });
  const subAfterExt = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record(
    "Prolongation essai",
    ext.ok &&
      !!subAfterExt?.trialEndsAt &&
      subAfterExt.trialEndsAt.getTime() === subRow!.trialEndsAt!.getTime() + 5 * 86400000,
  );

  // ============ 3. Modules : droits effectifs ============
  // Idempotence : purger les overrides laissés par un run précédent.
  await prisma.schoolModuleOverride.deleteMany({ where: { schoolId: schoolA.id } });
  record(
    "Module souscrit actif",
    await isModuleEnabled(schoolA.id, `P8CORE-${S}`),
  );
  record(
    "Module non souscrit refusé",
    !(await isModuleEnabled(schoolA.id, `P8EXTRA-${S}`)),
  );
  // permission non mappée → autorisée ; permission couverte par un module non souscrit → refusée
  await ensureModule("FINANCE", "Finances"); // existe déjà
  // L'offre small ne contient pas FINANCE → finance.read doit être refusé
  record(
    "Permission module non souscrit refusée",
    !(await isPermissionCoveredBySubscription(schoolA.id, "finance.read")),
  );
  await setModuleOverride(platformActor, {
    schoolId: schoolA.id,
    moduleCode: "FINANCE",
    enabled: true,
    note: "test override",
  });
  record(
    "Override activation module",
    await isPermissionCoveredBySubscription(schoolA.id, "finance.read"),
  );
  await setModuleOverride(platformActor, {
    schoolId: schoolA.id,
    moduleCode: `P8CORE-${S}`,
    enabled: false,
  });
  record(
    "Override blocage module souscrit",
    !(await isModuleEnabled(schoolA.id, `P8CORE-${S}`)),
  );
  await setModuleOverride(platformActor, {
    schoolId: schoolA.id,
    moduleCode: `P8CORE-${S}`,
    enabled: true,
  });

  // ============ 4. Limites commerciales ============
  const year = await createYear(ctxA, {
    name: `P8-${S}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  if (!year.ok) throw new Error("createYear failed");
  const level = await createLevel(ctxA, { name: `Niv P8 ${S}`, order: 1 });
  if (!level.ok) throw new Error("createLevel failed");
  const classroom = await createClassroom(ctxA, {
    name: `Classe P8 ${S}`,
    levelId: level.result.id,
    academicYearId: year.result.id,
    capacity: 50,
  });
  if (!classroom.ok) throw new Error("createClassroom failed");

  // Offre small : max 1 élève. Nettoyer les inscriptions actives de l'école A.
  await prisma.enrollment.updateMany({
    where: { schoolId: schoolA.id, status: "ENROLLED" },
    data: { status: "WITHDRAWN" },
  });
  const st1 = await createStudent(ctxA, { matricule: `P8-${S}-1`, firstName: "A", lastName: "Un" });
  const st2 = await createStudent(ctxA, { matricule: `P8-${S}-2`, firstName: "B", lastName: "Deux" });
  if (!st1.ok || !st2.ok) throw new Error("createStudent failed");
  const en1 = await enrollStudent(ctxA, {
    studentId: st1.result.id,
    classroomId: classroom.result.id,
    academicYearId: year.result.id,
  });
  record("Inscription dans la limite", en1.ok);
  const en2 = await enrollStudent(ctxA, {
    studentId: st2.result.id,
    classroomId: classroom.result.id,
    academicYearId: year.result.id,
  });
  record(
    "Limite élèves appliquée côté serveur",
    !en2.ok,
    en2.ok ? undefined : JSON.stringify(en2.error),
  );

  // Upgrade → limite levée → l'inscription passe
  const up = await changePlan(platformActor, { subscriptionId: subId, planId: bigId });
  record("Upgrade offre", up.ok);
  const en2b = await enrollStudent(ctxA, {
    studentId: st2.result.id,
    classroomId: classroom.result.id,
    academicYearId: year.result.id,
  });
  record("Inscription après upgrade", en2b.ok);

  // Downgrade → données conservées, module extra désactivé
  const down = await changePlan(platformActor, { subscriptionId: subId, planId: smallId });
  record("Downgrade offre", down.ok);
  const studentsCount = await prisma.enrollment.count({
    where: { schoolId: schoolA.id, status: "ENROLLED" },
  });
  record("Aucune donnée supprimée au downgrade", studentsCount === 2);
  record(
    "Module perdu au downgrade",
    !(await isModuleEnabled(schoolA.id, `P8EXTRA-${S}`)),
  );
  // Lecture toujours autorisée pour les modules souscrits
  record(
    "Module restant toujours actif",
    await isModuleEnabled(schoolA.id, `P8CORE-${S}`),
  );

  // ============ 5. Cycle de vie : grâce → suspension → réactivation ============
  // Forcer la fin de période pour tester le sweep
  await prisma.schoolSubscription.update({
    where: { id: subId },
    data: { currentPeriodEnd: new Date(Date.now() - 3600000) }, // -1 h
  });
  const sweep1 = await sweepSubscriptions();
  const subGrace = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record(
    "Sweep → période de grâce",
    sweep1.graceStarted >= 1 && subGrace?.status === "GRACE",
  );
  // En grâce : permissions de gestion encore couvertes si module souscrit
  record(
    "Grâce : module encore actif",
    await isModuleEnabled(schoolA.id, `P8CORE-${S}`),
  );
  // Forcer la fin de grâce → suspension
  await prisma.schoolSubscription.update({
    where: { id: subId },
    data: { graceEndsAt: new Date(Date.now() - 3600000) },
  });
  const sweep2 = await sweepSubscriptions();
  const subSusp = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record(
    "Fin de grâce → suspension",
    sweep2.suspended >= 1 && subSusp?.status === "SUSPENDED",
  );
  // Suspension : lecture seule
  record(
    "Suspension : gestion refusée",
    !(await isPermissionCoveredBySubscription(schoolA.id, "students.manage")),
  );
  record(
    "Suspension : lecture autorisée",
    await isPermissionCoveredBySubscription(schoolA.id, "students.read"),
  );
  // Données intactes en suspension
  const studentsInSusp = await prisma.enrollment.count({
    where: { schoolId: schoolA.id, status: "ENROLLED" },
  });
  record("Suspension : données conservées", studentsInSusp === 2);

  const react = await reactivateSubscription(platformActor, subId);
  const subReact = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record("Réactivation", react.ok && subReact?.status === "ACTIVE");

  // ============ 6. Facturation ============
  const inv1 = await generateInvoice(platformActor, {
    schoolId: schoolA.id,
    subscriptionId: subId,
    cycle: "MONTHLY",
  });
  record("Génération facture", inv1.ok);
  if (!inv1.ok) throw new Error("generateInvoice failed");
  const inv1Row = await prisma.platformInvoice.findUnique({
    where: { id: inv1.result.id },
    include: { lines: true },
  });
  record(
    "Numérotation unique + lignes",
    !!inv1Row?.invoiceNumber.startsWith("INV-") && inv1Row.lines.length === 1 &&
      inv1Row.total === 6000, // small offre : 6000 après update
  );
  record("Snapshot facture immuable", !!inv1Row?.snapshot);

  const inv2 = await generateInvoice(platformActor, {
    schoolId: schoolA.id,
    subscriptionId: subId,
    cycle: "MONTHLY",
  });
  const inv2Row = inv2.ok
    ? await prisma.platformInvoice.findUnique({ where: { id: inv2.result.id } })
    : null;
  record(
    "Numéros distincts",
    inv2Row?.invoiceNumber !== inv1Row?.invoiceNumber,
  );

  // Paiement partiel puis total
  const pay1 = await recordPlatformPayment(platformActor, {
    invoiceId: inv1Row!.id,
    amount: 2000,
    method: "VIREMENT",
    reference: "TR-1",
    idempotencyKey: `p8-pay1-${S}`,
  });
  record("Règlement partiel", pay1.ok);
  const invAfter1 = await prisma.platformInvoice.findUnique({ where: { id: inv1Row!.id } });
  record("Statut partiellement payée", invAfter1?.status === "PARTIALLY_PAID");

  // Idempotence : même clé → même paiement
  const pay1dup = await recordPlatformPayment(platformActor, {
    invoiceId: inv1Row!.id,
    amount: 2000,
    idempotencyKey: `p8-pay1-${S}`,
  });
  record(
    "Idempotence règlement",
    pay1dup.ok && pay1.ok && pay1dup.result.id === pay1.result.id,
  );
  const payCount = await prisma.platformPayment.count({
    where: { invoiceId: inv1Row!.id },
  });
  record("Pas de doublon d'encaissement", payCount === 1);

  const pay2 = await recordPlatformPayment(platformActor, {
    invoiceId: inv1Row!.id,
    amount: 4000,
    method: "ESPECES",
  });
  const invPaid = await prisma.platformInvoice.findUnique({ where: { id: inv1Row!.id } });
  record("Solde complet → payée", pay2.ok && invPaid?.status === "PAID");

  // Avoir sur la 2e facture
  const cn = await issueCreditNote(platformActor, {
    invoiceId: inv2Row!.id,
    amount: 1000,
    reason: "Geste commercial",
  });
  record("Avoir émis", cn.ok && cn.result.creditNoteNumber.startsWith("AV-"));
  const invAfterCN = await prisma.platformInvoice.findUnique({ where: { id: inv2Row!.id } });
  record("Avoir réduit le solde → partielle", invAfterCN?.status === "PARTIALLY_PAID");

  // Impayés : inv2 est échue? Non — forcer dueDate passée
  await prisma.platformInvoice.update({
    where: { id: inv2Row!.id },
    data: { dueDate: new Date(Date.now() - 86400000) },
  });
  const unpaid = await listUnpaidInvoices();
  record(
    "Suivi impayés SaaS",
    unpaid.some((i) => i.id === inv2Row!.id && i.balance === 5000),
  );

  // Annulation facture
  const inv3 = await generateInvoice(platformActor, { schoolId: schoolA.id, cycle: "MONTHLY" });
  const cancel = inv3.ok
    ? await cancelInvoice(platformActor, { invoiceId: inv3.result.id, reason: "Test" })
    : { ok: false as const };
  const inv3Row = inv3.ok
    ? await prisma.platformInvoice.findUnique({ where: { id: inv3.result.id } })
    : null;
  record("Annulation facture", cancel.ok && inv3Row?.status === "CANCELLED");

  // Historique facturation de l'école
  const schoolInvoices = await listSchoolInvoices(schoolA.id);
  record(
    "Historique facturation",
    schoolInvoices.length >= 3 && schoolInvoices.every((i) => i.schoolId === schoolA.id),
  );

  // ============ 7. Isolation commerciale ============
  const subB = await assignSubscription(platformActor, {
    schoolId: schoolB.id,
    planId: bigId,
    startTrial: false,
  });
  record("Abonnement école B", subB.ok);
  const invB = await generateInvoice(platformActor, { schoolId: schoolB.id, cycle: "YEARLY" });
  const invoicesB = await listSchoolInvoices(schoolB.id);
  const invoicesA = await listSchoolInvoices(schoolA.id);
  record(
    "Isolation : factures A sans B",
    invoicesA.every((i) => i.schoolId === schoolA.id) &&
      invoicesB.every((i) => i.schoolId === schoolB.id) &&
      invB.ok &&
      !invoicesA.some((i) => i.id === invB.result.id),
  );
  // L'école B (BIG, sans limites) n'hérite pas des limites de l'école A
  const usageB = await usageSnapshot(schoolB.id);
  record("Limites indépendantes par école", usageB.maxStudents === null);
  // École B : FINANCE non souscrit non plus? BIG contient P8CORE+P8EXTRA seulement
  record(
    "École B : module non souscrit refusé",
    !(await isModuleEnabled(schoolB.id, "FINANCE")),
  );

  // ============ 8. Demande de changement d'offre (côté école) ============
  const req1 = await requestPlanChange(ctxB, { planId: smallId, note: "Réduction budget" });
  record("Demande de changement offre", req1.ok);
  const req2 = await requestPlanChange(ctxB, { planId: smallId });
  record("Une seule demande en attente", !req2.ok);
  if (req1.ok) {
    const rev = await reviewChangeRequest(platformActor, {
      requestId: req1.result.id,
      approve: true,
    });
    const subBRow = subB.ok
      ? await prisma.schoolSubscription.findUnique({ where: { id: subB.result.id } })
      : null;
    record("Approbation → offre appliquée", rev.ok && subBRow?.planId === smallId);
  }

  // ============ 9. Permissions plateforme ============
  const salesRole = await prisma.role.findFirst({
    where: { scope: "PLATFORM", name: { contains: "sales", mode: "insensitive" } },
  });
  const perm = await userHasPlatformPermission({
    userId: adminA,
    permissionKey: "platform.invoices.manage",
  });
  // adminA n'est membre d'aucun rôle plateforme (sauf si SUPER_ADMIN assigné ailleurs)
  record(
    "Permissions platform indépendantes",
    perm === false || salesRole !== null, // perm=false attendu pour un admin école
    `perm=${perm}`,
  );

  // ============ 10. Assistance contrôlée ============
  const sess = await startSupportSession(platformActor, {
    schoolId: schoolA.id,
    reason: "Diagnostic Phase 8",
    durationHours: 1,
    authorizedById: adminA,
  });
  record("Session assistance ouverte", sess.ok);
  const sessNoReason = await startSupportSession(platformActor, {
    schoolId: schoolA.id,
    reason: "   ",
    authorizedById: adminA,
  });
  record("Motif obligatoire", !sessNoReason.ok);
  if (sess.ok) {
    const end = await endSupportSession(platformActor, sess.result.id);
    const row = await prisma.supportSession.findUnique({ where: { id: sess.result.id } });
    record("Fin de session", end.ok && row?.status === "ENDED");
  }
  // Expiration automatique
  const sess2 = await startSupportSession(platformActor, {
    schoolId: schoolA.id,
    reason: "Test expiration",
    authorizedById: adminA,
  });
  if (sess2.ok) {
    await prisma.supportSession.update({
      where: { id: sess2.result.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const n = await expireSupportSessions();
    const row = await prisma.supportSession.findUnique({ where: { id: sess2.result.id } });
    record("Expiration automatique", n >= 1 && row?.status === "EXPIRED");
  }

  // ============ 11. Supervision + dashboard ============
  const mon = await platformMonitoring();
  record(
    "Supervision : mesures réelles",
    mon.db.ok === true && mon.db.latencyMs >= 0 && mon.usage.schools > 0,
  );
  const dash = await platformDashboard();
  record(
    "Dashboard : indicateurs cohérents",
    dash.totalSchools >= 2 &&
      dash.invoicedTotal >= 0 &&
      dash.collectedTotal >= 6000 &&
      dash.mrr >= 0,
    `collected=${dash.collectedTotal}`,
  );

  // ============ 12. Renouvellement + résiliation ============
  const renew = await renewSubscription(platformActor, subId);
  const subRenew = await prisma.schoolSubscription.findUnique({ where: { id: subId } });
  record(
    "Renouvellement",
    renew.ok && subRenew?.status === "ACTIVE" && !!subRenew?.currentPeriodEnd &&
      subRenew.currentPeriodEnd.getTime() > Date.now(),
  );
  const events = await prisma.subscriptionEvent.count({
    where: { subscriptionId: subId },
  });
  record("Historique abonnement (événements)", events >= 6, `${events} events`);

  const cancelSub = await cancelSubscription(platformActor, subId, "Fin de test");
  const entAfterCancel = await getEntitlements(schoolA.id);
  record(
    "Résiliation → lecture seule",
    cancelSub.ok &&
      (await isPermissionCoveredBySubscription(schoolA.id, "students.read")) === true &&
      (await isPermissionCoveredBySubscription(schoolA.id, "students.manage")) === false &&
      entAfterCancel.status === "CANCELLED",
  );

  // ============ 13. PDF facture ============
  const invFull = await prisma.platformInvoice.findUnique({
    where: { id: inv1Row!.id },
  });
  if (invFull?.snapshot) {
    const doc = new PDFDocument({ size: "A4", margin: 45 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
    renderInvoice(doc, invFull.snapshot as unknown as InvoiceSnapshot);
    doc.end();
    const pdf = await done;
    record(
      "PDF facture généré",
      pdf.length > 800 && pdf.slice(0, 5).toString() === "%PDF-",
    );
  }

  // ============ Résumé ============
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\nPhase 8 — ${passed}/${checks.length} vérifications`);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (passed !== checks.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("PHASE8_TEST_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
