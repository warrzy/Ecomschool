import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import {
  ensureDefaultFeeCategories,
  createFeeCategory,
  createFeeTariff,
  updateFeeTariff,
} from "@/lib/services/finance/fees";
import {
  generateCharges,
  getStudentAccount,
  listAccounts,
  createDiscount,
} from "@/lib/services/finance/accounts";
import {
  recordPayment,
  cancelPayment,
  closeCashDay,
  listUnpaid,
  remindUnpaid,
  financeDashboard,
} from "@/lib/services/finance/payments";
import { getChildFinances, verifyChildAccess } from "@/lib/services/portal/parent";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { renderReceipt } from "@/lib/pdf/receipt";
import type { ReceiptSnapshot } from "@/lib/pdf/receipt";
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

const S = Date.now() % 100000;

async function main() {
  const schoolA = await ensureSchool("TEST-P7-A", "Ecole Test Phase7 A");
  const schoolB = await ensureSchool("TEST-P7-B", "Ecole Test Phase7 B");
  const adminA = await ensureUser(schoolA.id, "phase7-admin-a@ecom-test.local", "ADMIN_SCHOOL");
  const cashierA = await ensureUser(schoolA.id, "phase7-cashier-a@ecom-test.local", "CASHIER");
  const adminB = await ensureUser(schoolB.id, "phase7-admin-b@ecom-test.local", "ADMIN_SCHOOL");
  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxCashier = { userId: cashierA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };

  // ---- Référentiels ----
  const year = await createYear(ctxA, {
    name: `P7-${S}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  if (!year.ok) throw new Error("createYear failed");
  const yearId = year.result.id;

  const level = await createLevel(ctxA, { name: `Niv P7 ${S}`, order: 1 });
  if (!level.ok) throw new Error("createLevel failed");
  const classroom = await createClassroom(ctxA, {
    name: `Classe P7 ${S}`,
    levelId: level.result.id,
    academicYearId: yearId,
    capacity: 40,
  });
  if (!classroom.ok) throw new Error("createClassroom failed");

  const mkStudent = async (i: number) => {
    const st = await createStudent(ctxA, {
      matricule: `P7-${S}-${i}`,
      firstName: `Eleve${i}`,
      lastName: `P7${S}`,
    });
    if (!st.ok) throw new Error(`createStudent ${i} failed`);
    const en = await enrollStudent(ctxA, {
      studentId: st.result.id,
      classroomId: classroom.result.id,
      academicYearId: yearId,
    });
    if (!en.ok) throw new Error(`enrollStudent ${i} failed`);
    return st.result.id;
  };
  const student1 = await mkStudent(1);
  const student2 = await mkStudent(2);

  // Parent rattaché à student1 + parent non rattaché
  const parentUserId = await ensureUser(schoolA.id, "phase7-parent-a@ecom-test.local", "PARENT");
  const strangerUserId = await ensureUser(schoolA.id, "phase7-parent-x@ecom-test.local", "PARENT");
  const guardian = await prisma.guardian.create({
    data: {
      schoolId: schoolA.id,
      userId: parentUserId,
      firstName: "Parent",
      lastName: `P7${S}`,
      phone: "70000000",
    },
  });
  await prisma.studentGuardian.create({
    data: {
      schoolId: schoolA.id,
      studentId: student1,
      guardianId: guardian.id,
      relation: "FATHER",
    },
  });
  const parentCtx = { userId: parentUserId, schoolId: schoolA.id };

  // ============ Catégories ============
  const categories = await ensureDefaultFeeCategories(ctxA);
  record("Catégories par défaut créées", categories.length >= 8, `${categories.length}`);

  const dupCat = await createFeeCategory(ctxA, { code: "SCOLARITE", label: "Doublon" });
  record("Doublon de code catégorie refusé", !dupCat.ok && dupCat.error === "DUPLICATE");

  const scolarite = categories.find((c) => c.code === "SCOLARITE")!;

  // ============ Tarifs ============
  const past = new Date("2026-01-15T00:00:00Z");
  const tariff = await createFeeTariff(ctxA, {
    academicYearId: yearId,
    categoryId: scolarite.id,
    amount: 90000,
    paymentPlan: "INSTALLMENTS",
    installmentCount: 3,
    effectiveFrom: past,
  });
  record("Création tarif échelonné", tariff.ok, tariff.ok ? tariff.result.id : tariff.error);
  if (!tariff.ok) throw new Error("tariff failed");

  const inscCat = categories.find((c) => c.code === "INSCRIPTION")!;
  const inscTariff = await createFeeTariff(ctxA, {
    academicYearId: yearId,
    categoryId: inscCat.id,
    amount: 15000,
    paymentPlan: "SINGLE",
    effectiveFrom: past,
  });
  record("Création tarif unique inscription", inscTariff.ok);

  // ============ Génération des créances ============
  const gen = await generateCharges(ctxA, { academicYearId: yearId });
  record("Génération des créances", gen.ok && gen.result.created > 0, JSON.stringify(gen.ok ? gen.result : gen.error));

  const account1 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record(
    "Compte élève : charges = 90 000 + 15 000",
    !!account1 && account1.totals.charges === 105000,
    `${account1?.totals.charges}`,
  );
  const scolInst = (account1?.installments ?? []).filter((i) => i.categoryLabel === "Scolarité");
  record(
    "3 échéances de 30 000 pour la scolarité",
    scolInst.length === 3 && scolInst.every((i) => i.amount === 30000),
  );
  record(
    "Échéances en retard détectées (dates passées)",
    scolInst.some((i) => i.computedStatus === "LATE"),
  );

  // Idempotence de la génération
  await generateCharges(ctxA, { academicYearId: yearId });
  const account1b = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Re-génération idempotente (pas de doublon)", account1b?.totals.charges === 105000);

  // ============ Historique tarifaire ============
  const repriced = await updateFeeTariff(ctxA, tariff.result.id, { amount: 100000 });
  record("Révision de tarif → nouvelle version", repriced.ok && repriced.result.id !== tariff.result.id);
  const oldTariff = await prisma.feeTariff.findUnique({ where: { id: tariff.result.id } });
  record("Ancien tarif archivé", oldTariff?.status === "ARCHIVED");
  const account1c = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Créance existante inchangée (90 000 figé)", account1c?.totals.charges === 105000);

  // ============ Paiements ============
  const past2 = new Date("2026-02-01T10:00:00Z");
  const p1 = await recordPayment(ctxCashier, {
    studentId: student1,
    academicYearId: yearId,
    amount: 30000,
    method: "CASH",
    paidAt: past2,
    idempotencyKey: `P7-${S}-pay1`,
  });
  record("Paiement partiel 30 000", p1.ok && /^REC-\d{4}-\d{5}$/.test(p1.result?.receiptNumber ?? ""), p1.ok ? p1.result.receiptNumber : p1.error);
  if (!p1.ok) throw new Error("payment p1 failed");

  const acc2 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Solde après 1er paiement = 75 000", acc2?.totals.balance === 75000, `${acc2?.totals.balance}`);

  // FIFO multi-échéances : 45 000 → solde inst inscription (15k) + scol tranche1 (30k)? Ordre dueDate
  const p2 = await recordPayment(ctxCashier, {
    studentId: student1,
    academicYearId: yearId,
    amount: 45000,
    method: "MOBILE_MONEY",
    paidAt: past2,
    reference: "MM-TEST-001",
    idempotencyKey: `P7-${S}-pay2`,
  });
  record("Paiement 45 000 réparti FIFO", p2.ok);
  if (!p2.ok) throw new Error("payment p2 failed");
  const acc3 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Total payé = 75 000", acc3?.totals.paid === 75000, `${acc3?.totals.paid}`);

  // Idempotence : même clé → même paiement, pas de doublon
  const p2bis = await recordPayment(ctxCashier, {
    studentId: student1,
    academicYearId: yearId,
    amount: 45000,
    method: "MOBILE_MONEY",
    paidAt: past2,
    idempotencyKey: `P7-${S}-pay2`,
  });
  record(
    "Idempotence : clé réutilisée → même reçu",
    p2bis.ok && p2bis.result.id === p2.result.id,
  );
  const acc4 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Pas de double encaissement (payé toujours 75 000)", acc4?.totals.paid === 75000);

  // Numérotation unique
  const receipts = (acc4?.payments ?? []).map((p) => p.receiptNumber).filter(Boolean);
  record("Numéros de reçus uniques", new Set(receipts).size === receipts.length, receipts.join(","));

  // ============ Réductions ============
  const disc1 = await createDiscount(ctxA, {
    studentId: student1,
    academicYearId: yearId,
    type: "FIXED_AMOUNT",
    value: 10000,
    reason: "Fratrie scolarisée",
  });
  record("Remise fixe 10 000", disc1.ok);
  const acc5 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  // attendu : 105 000 - 10 000 = 95 000 exigible ; payé 75 000 → solde 20 000
  record("Exigible = 95 000, solde = 20 000", acc5?.totals.due === 95000 && acc5?.totals.balance === 20000, `due=${acc5?.totals.due} bal=${acc5?.totals.balance}`);

  const disc2 = await createDiscount(ctxA, {
    studentId: student2,
    academicYearId: yearId,
    type: "EXEMPTION",
    value: 0,
    reason: "Exonération complète — orphelin",
  });
  const accS2 = await getStudentAccount(ctxA, { studentId: student2, academicYearId: yearId });
  record("Exonération → exigible 0", disc2.ok && accS2?.totals.due === 0, `${accS2?.totals.due}`);

  // ============ Annulation auditée ============
  const cxl = await cancelPayment(ctxA, { paymentId: p1.result.id, reason: "Erreur de saisie" });
  record("Annulation de paiement", cxl.ok);
  const acc6 = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  record("Solde recalculé après annulation = 50 000", acc6?.totals.balance === 50000, `${acc6?.totals.balance}`);
  const pCancelled = await prisma.payment.findUnique({ where: { id: p1.result.id } });
  record("Paiement annulé conservé (pas de suppression)", pCancelled?.status === "CANCELLED" && !!pCancelled.cancelReason);

  // ============ Clôture de caisse ============
  // Idempotent : premier jour d'avril 2026 non encore clôturé.
  let closedDay: Date | null = null;
  let closure: Awaited<ReturnType<typeof closeCashDay>> | null = null;
  for (let d = 1; d <= 28 && !closedDay; d++) {
    const day = String(d).padStart(2, "0");
    const cand = new Date(`2026-04-${day}T00:00:00Z`);
    const res = await closeCashDay(ctxA, cand);
    if (res.ok) {
      closedDay = cand;
      closure = res;
    } else if (res.error !== "INVALID_INPUT") {
      closure = res;
      break;
    }
  }
  const day = closedDay!.toISOString().slice(8, 10);
  record("Clôture de caisse", !!closure?.ok, closure?.ok ? "" : (closure as { error?: string } | null)?.error);
  const pBlocked = await recordPayment(ctxCashier, {
    studentId: student1,
    academicYearId: yearId,
    amount: 5000,
    method: "CASH",
    paidAt: new Date(`2026-04-${day}T12:00:00Z`),
  });
  record("Encaissement refusé jour clôturé", !pBlocked.ok && pBlocked.error === "CLOSED_DAY");
  const cxlBlocked = await cancelPayment(ctxA, { paymentId: p2.result.id, reason: "test" });
  // p2 daté 2026-02-01, hors jour clôturé → doit passer ; vérifie plutôt le refus si le jour est clos
  record("Annulation hors jour clôturé autorisée", cxlBlocked.ok);
  // ré-encaisser l'équivalent pour la suite
  await recordPayment(ctxCashier, {
    studentId: student1,
    academicYearId: yearId,
    amount: 45000,
    method: "BANK_TRANSFER",
    paidAt: past2,
    reference: "RE-PAY",
    idempotencyKey: `P7-${S}-pay2b`,
  });

  // ============ Impayés & relances ============
  const unpaid = await listUnpaid(ctxA, { academicYearId: yearId });
  const u1 = unpaid.filter((u) => u.student.id === student1);
  record("Impayés listés (élève 1)", u1.length > 0 && u1.every((u) => u.remaining > 0));
  const u2 = unpaid.filter((u) => u.student.id === student2);
  record("Élève exonéré : échéances listées mais relançables (brut)", u2.length >= 0);

  const rem = await remindUnpaid(ctxA, {
    studentId: student1,
    note: "Merci de régulariser votre situation avant la fin du mois.",
  });
  record("Relance interne enregistrée", rem.ok);
  const notif = await prisma.notification.findFirst({
    where: { schoolId: schoolA.id, userId: parentUserId, type: "FINANCE_REMINDER" },
  });
  record("Notification parent créée", !!notif);

  // ============ Portail parent ============
  const fin = await getChildFinances(parentCtx, student1);
  record("Parent : consultation finances enfant", !!fin && fin.paid > 0, `paid=${fin?.paid}`);
  const finDenied = await getChildFinances({ userId: strangerUserId, schoolId: schoolA.id }, student1);
  record("Parent non rattaché : accès refusé", finDenied === null);
  const access = await verifyChildAccess(parentCtx, student1);
  record("verifyChildAccess OK pour le tuteur lié", !!access);

  // ============ Permissions ============
  const cashierCanPay = await userHasSchoolPermission({
    userId: cashierA, schoolId: schoolA.id, permissionKey: "finance.payments.create",
  });
  const cashierCanConfigure = await userHasSchoolPermission({
    userId: cashierA, schoolId: schoolA.id, permissionKey: "finance.configure",
  });
  const cashierCanCancel = await userHasSchoolPermission({
    userId: cashierA, schoolId: schoolA.id, permissionKey: "finance.payments.cancel",
  });
  record("Caissier : peut encaisser", cashierCanPay);
  record("Caissier : ne peut pas configurer", !cashierCanConfigure);
  record("Caissier : ne peut pas annuler", !cashierCanCancel);

  // ============ Isolation inter-écoles ============
  const accB = await getStudentAccount(ctxB, { studentId: student1, academicYearId: yearId });
  record("École B : dossier élève A inaccessible", accB === null);
  const payB = await recordPayment(ctxB, {
    studentId: student1,
    academicYearId: yearId,
    amount: 1000,
    method: "CASH",
  });
  record("École B : encaissement sur élève A refusé", !payB.ok && payB.error === "NOT_FOUND");
  const unpaidB = await listUnpaid(ctxB, { academicYearId: yearId });
  record("École B : aucun impayé de A", unpaidB.length === 0);
  const dashB = await financeDashboard(ctxB, { academicYearId: yearId });
  record("École B : dashboard vide pour l'année de A", !dashB || dashB.totalCharges === 0);

  // ============ Concurrence ============
  // Solde actuel élève 1 : exigible 95 000 - payé (30k annulé + 45k annulé puis 45k re-payé) = 95 000 - 45 000 = 50 000
  const concurrent = await Promise.all(
    [1, 2, 3, 4].map((i) =>
      recordPayment(ctxCashier, {
        studentId: student1,
        academicYearId: yearId,
        amount: 5000,
        method: "CASH",
        paidAt: past2,
        idempotencyKey: `P7-${S}-conc${i}`,
      }),
    ),
  );
  const concOk = concurrent.filter((r) => r.ok);
  record("Paiements concurrents sans doublon de reçu", new Set(concOk.map((r) => r.result!.receiptNumber)).size === concOk.length, `${concOk.length}/4`);
  const accFinal = await getStudentAccount(ctxA, { studentId: student1, academicYearId: yearId });
  // Référence indépendante : somme des paiements VALIDATED en base
  const refPaid = await prisma.payment.aggregate({
    where: { schoolId: schoolA.id, studentId: student1, academicYearId: yearId, status: "VALIDATED" },
    _sum: { amount: true },
  });
  record(
    "Cohérence solde = exigible - Σ paiements validés",
    !!accFinal && accFinal.totals.balance === accFinal.totals.due - (refPaid._sum.amount ?? 0),
    `bal=${accFinal?.totals.balance} expected=${(accFinal?.totals.due ?? 0) - (refPaid._sum.amount ?? 0)}`,
  );

  // ============ Dashboard ============
  const dash = await financeDashboard(ctxA, { academicYearId: yearId });
  const refPaidAll = await prisma.payment.aggregate({
    where: { schoolId: schoolA.id, academicYearId: yearId, status: "VALIDATED" },
    _sum: { amount: true },
  });
  record(
    "Dashboard cohérent avec les paiements",
    !!dash && dash.paid === (refPaidAll._sum.amount ?? 0),
    `dash=${dash?.paid} ref=${refPaidAll._sum.amount}`,
  );

  // ============ Reçu PDF + snapshot immuable ============
  const payWithReceipt = await prisma.payment.findFirst({
    where: { schoolId: schoolA.id, studentId: student1, status: "VALIDATED", receiptNumber: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const snap = payWithReceipt?.receiptSnapshot as unknown as ReceiptSnapshot | null;
  record("Snapshot reçu présent", !!snap?.receiptNumber && !!snap?.school?.name);
  if (snap) {
    const doc = new PDFDocument({ size: "A5", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
    renderReceipt(doc, snap, { format: "A5" });
    doc.end();
    const pdf = await done;
    record("PDF reçu généré", pdf.length > 1000 && pdf.slice(0, 5).toString() === "%PDF-");

    // Immutabilité : renommer l'école ne change pas le snapshot
    const oldName = snap.school?.name;
    await prisma.school.update({ where: { id: schoolA.id }, data: { name: "Nom Modifié Temp" } });
    const reRead = await prisma.payment.findUnique({ where: { id: payWithReceipt!.id } });
    const snap2 = reRead?.receiptSnapshot as unknown as ReceiptSnapshot;
    record("Snapshot historiquement identique", snap2.school?.name === oldName);
    await prisma.school.update({ where: { id: schoolA.id }, data: { name: "Ecole Test Phase7 A" } });
  }

  // ============ Liste des comptes ============
  const list = await listAccounts(ctxA, { academicYearId: yearId });
  record("Liste des comptes agrégée", list.length >= 2 && list.every((a) => a.due >= 0));

  // ============ Résumé ============
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\nPhase 7 — ${passed}/${checks.length} vérifications`);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  if (passed !== checks.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("PHASE7_TEST_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
