import "../lib/recette-guard";
/**
 * TESTS DE STABILISATION — correctifs audit (B1→B5, M1→M11, mineurs).
 * Base isolée requise (ALLOW_RECETTE=1, DATABASE_URL ≠ prod).
 * Exécution : DATABASE_URL=...schema=rh9test ALLOW_RECETTE=1 npx tsx scripts/preprod/test-stabilisation.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { recordPayment, cancelPayment } from "@/lib/services/finance/payments";
import { updateInstallment, generateStudentCharges } from "@/lib/services/finance/accounts";
import {
  installStarterPlan, openExercise, generateEntries, closeExercise, createManualEntry,
} from "@/lib/services/accounting";
import { createAsset, runDepreciation, disposeAsset } from "@/lib/services/accounting/assets";
import { enrollStudent } from "@/lib/services/enrollments";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { requestLeave, decideLeave, markAttendance } from "@/lib/services/hr/leaves";
import { createRun, computeRun, getRun, setAttendanceConfig } from "@/lib/services/hr/payroll";
import { listNotifications, unreadCount, markAllRead } from "@/lib/services/notifications";

let pass = 0, fail = 0;
const check = (l: string, c: boolean) => { if (c) pass++; else fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${l}`); };

async function main() {
  const ts = Date.now() % 1e7;
  const mk = async (tag: string, keys: string[]) => {
    const s = await prisma.school.create({ data: { name: `STAB ${tag}`, code: `ST${tag}${ts}`, slug: `st-${tag.toLowerCase()}-${ts}` } });
    const u = await prisma.user.create({ data: { email: `st${tag}-${ts}@t.l`, passwordHash: "x" } });
    const role = await prisma.role.create({ data: { name: `ST_${tag}`, scope: "SCHOOL", schoolId: s.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.schoolMembership.create({ data: { userId: u.id, schoolId: s.id, roleId: role.id } });
    return { userId: u.id, schoolId: s.id };
  };

  // ========== S-A : B2 intégrité allocations + batch + M3 clôture ==========
  console.log("== S-A : B2 allocations & batch, M3 clôture ==");
  const ctxA = await mk("A", ["finance.manage", "finance.read", "accounting.read", "accounting.manage"]);
  await installStarterPlan(ctxA);
  const ex = (await prisma.accountingExercise.findFirst({ where: { schoolId: ctxA.schoolId, status: "OPEN" } }))
    ?? await prisma.accountingExercise.create({ data: { schoolId: ctxA.schoolId, name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
  // Mode CASH : le crédit de l'écriture de paiement est calculé sur les
  // ALLOCATIONS — une sous-allocation produit une écriture déséquilibrée
  // (le cas B2), capturée par-source au lieu d'avorter le batch.
  const year = await prisma.academicYear.create({ data: { schoolId: ctxA.schoolId, name: "2026-2027", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-20"), isCurrent: true } });
  const st = await prisma.student.create({ data: { schoolId: ctxA.schoolId, matricule: "SA1", firstName: "T", lastName: "P", birthDate: new Date("2012-01-01") } });
  const cat = await prisma.feeCategory.create({ data: { schoolId: ctxA.schoolId, code: "SCOL", label: "Scolarité" } });
  const charge = await prisma.studentFeeCharge.create({ data: { schoolId: ctxA.schoolId, studentId: st.id, academicYearId: year.id, categoryId: cat.id, amount: 50000 } });
  const inst = await prisma.feeInstallment.create({ data: { schoolId: ctxA.schoolId, studentId: st.id, academicYearId: year.id, chargeId: charge.id, dueDate: new Date("2026-03-15"), amount: 50000 } });

  // A1 : allocations explicites dont Σ ≠ montant → INVALID_INPUT
  const badSum = await recordPayment(ctxA, { studentId: st.id, academicYearId: year.id, amount: 30000, method: "CASH", allocations: [{ installmentId: inst.id, amount: 20000 }] });
  check("Σ allocations explicites ≠ montant → INVALID_INPUT", !badSum.ok && badSum.error === "INVALID_INPUT");

  // A2 : paiement sans échéance couvrante → UNALLOCATED_AMOUNT (jamais d'écriture déséquilibrée)
  const st2 = await prisma.student.create({ data: { schoolId: ctxA.schoolId, matricule: "SA2", firstName: "U", lastName: "Q", birthDate: new Date("2012-01-01") } });
  await prisma.studentFeeCharge.create({ data: { schoolId: ctxA.schoolId, studentId: st2.id, academicYearId: year.id, categoryId: cat.id, amount: 40000 } });
  const noAlloc = await recordPayment(ctxA, { studentId: st2.id, academicYearId: year.id, amount: 40000, method: "CASH" });
  check("sans échéance couvrante → UNALLOCATED_AMOUNT", !noAlloc.ok && noAlloc.error === "UNALLOCATED_AMOUNT");

  // A3 : paiement valide puis updateInstallment sous le déjà-alloué → BELOW_ALLOCATED
  const okPay = await recordPayment(ctxA, { studentId: st.id, academicYearId: year.id, amount: 30000, method: "CASH", idempotencyKey: "K-ST-A" });
  check("paiement valide ok", okPay.ok === true);
  const below = await updateInstallment(ctxA, inst.id, { amount: 10000 });
  check("échéance < déjà alloué → BELOW_ALLOCATED", !below.ok && below.error === "BELOW_ALLOCATED");

  // A4 : batch generateEntries — une source fautive n'avorte pas le reste.
  // Paiement « corrompu » : VALIDATED avec une allocation partielle
  // (Σ allocations 20 000 < montant 40 000) → écriture déséquilibrée,
  // capturée par-source au lieu d'avorter tout le batch.
  const inst2 = await prisma.feeInstallment.create({ data: { schoolId: ctxA.schoolId, studentId: st2.id, academicYearId: year.id, chargeId: (await prisma.studentFeeCharge.findFirstOrThrow({ where: { studentId: st2.id } })).id, dueDate: new Date("2026-03-15"), amount: 40000 } });
  const badP = await prisma.payment.create({
    data: { schoolId: ctxA.schoolId, studentId: st2.id, academicYearId: year.id, amount: 40000, method: "CASH", status: "VALIDATED", receiptNumber: "REC-BAD-1",
      allocations: { create: [{ installmentId: inst2.id, amount: 20000 }] } },
  });
  const gen = await generateEntries(ctxA);
  check("generateEntries ok malgré source fautive", gen.ok === true);
  const genStats = gen.ok ? gen.result : null;
  check("erreur source tracée dans stats.errors", (genStats?.errors.length ?? 0) >= 1);
  check("écriture du paiement valide quand même postée", (genStats?.payments ?? 0) >= 1);
  const badEntry = await prisma.accountingEntry.count({ where: { schoolId: ctxA.schoolId, sourceType: "PAYMENT", description: { contains: "REC-BAD" } } });
  check("source fautive sans écriture", badEntry === 0);

  // A5 : M3 — clôture refusée tant qu'un paiement de l'exercice n'est pas posté
  const cl = await closeExercise(ctxA, ex.id);
  check("clôture refusée : UNPOSTED_OPERATIONS", !cl.ok && cl.error === "UNPOSTED_OPERATIONS");

  // A6 : tout posté → clôture acceptée
  const gen2 = await generateEntries(ctxA);
  check("second passage batch : 0 erreur résiduelle fatale", gen2.ok === true);
  // Annuler le paiement corrompu : sans écriture PAYMENT d'origine, aucune
  // contre-passation n'est exigée — la clôture ne doit PAS rester bloquée.
  await prisma.payment.update({ where: { id: badP.id }, data: { status: "CANCELLED", cancelledAt: new Date("2026-06-01") } });
  const cl2 = await closeExercise(ctxA, ex.id);
  check("annulation sans écriture d'origine → clôture possible", cl2.ok === true);

  // ========== S-B : M4 immobilisations ==========
  console.log("== S-B : M4 acquisition + dotation + sortie ==");
  const ctxB = await mk("B", ["accounting.manage", "accounting.read"]);
  await installStarterPlan(ctxB);
  const exB = await openExercise(ctxB, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  check("exercice B ouvert", exB.ok === true);
  const accOf = async (code: string) => prisma.accountingAccount.findFirstOrThrow({ where: { schoolId: ctxB.schoolId, code } });
  const a241 = await accOf("201");
  const a281 = await accOf("281");
  const a681 = await accOf("681");
  const a481 = await accOf("401");
  // Compte VNC (sortie) : absent du plan de démarrage → créé pour le test.
  await prisma.accountingAccount.upsert({
    where: { schoolId_code: { schoolId: ctxB.schoolId, code: "81" } },
    create: { schoolId: ctxB.schoolId, code: "81", name: "VNC cessions", classNumber: 8 },
    update: {},
  });
  const asset = await createAsset(ctxB, {
    label: "Ordinateur", acquisitionDate: new Date("2026-02-01"), acquisitionCost: 300000,
    durationMonths: 36, accountAssetId: a241.id, accountDepreciationId: a281.id, accountChargeId: a681.id,
    counterpartAccountId: a481.id,
  });
  check("createAsset ok", asset.ok === true);
  const acqEntry = asset.ok ? await prisma.accountingEntry.findFirst({ where: { schoolId: ctxB.schoolId, sourceType: "ASSET_ACQ", sourceId: asset.result.id }, include: { lines: true } }) : null;
  check("écriture acquisition présente", !!acqEntry);
  check("acquisition équilibrée 300 000", (acqEntry?.lines.reduce((s, l) => s + l.debit, 0) ?? 0) === 300000 && (acqEntry?.lines.reduce((s, l) => s + l.credit, 0) ?? 0) === 300000);

  const dep = await runDepreciation(ctxB, 2026, 3);
  check("dotation mars ok", dep.ok === true && dep.result.posted >= 1);
  const sched = asset.ok ? await prisma.assetSchedule.findFirst({ where: { assetId: asset.result.id }, select: { entryId: true, amount: true } }) : null;
  check("schedule + entryId atomiques", !!sched?.entryId && sched.amount > 0);

  const disp = asset.ok ? await disposeAsset(ctxB, asset.result.id, "SOLD") : { ok: false };
  check("disposeAsset ok", disp.ok === true);
  const dispEntry = asset.ok ? await prisma.accountingEntry.findFirst({ where: { schoolId: ctxB.schoolId, sourceType: "ASSET_DISPOSAL", sourceId: asset.result.id }, include: { lines: true } }) : null;
  check("écriture de sortie présente et équilibrée", !!dispEntry && dispEntry.lines.reduce((s, l) => s + l.debit, 0) === dispEntry.lines.reduce((s, l) => s + l.credit, 0));
  const assetRow = asset.ok ? await prisma.accountingAsset.findUnique({ where: { id: asset.result.id }, select: { status: true } }) : null;
  check("statut SOLD atomique avec l'écriture", assetRow?.status === "SOLD");

  // ========== S-C : M5 notifications scopées ==========
  console.log("== S-C : M5 notifications scopées tenant ==");
  const ctxX = await mk("X", ["student.read"]);
  const ctxY = await mk("Y", ["student.read"]);
  const sharedUser = ctxX.userId; // même utilisateur, deux écoles
  await prisma.notification.createMany({ data: [
    { schoolId: ctxX.schoolId, userId: sharedUser, type: "ADMIN_MESSAGE", title: "Notif X" },
    { schoolId: ctxY.schoolId, userId: sharedUser, type: "ADMIN_MESSAGE", title: "Notif Y" },
    { schoolId: null, userId: sharedUser, type: "ADMIN_MESSAGE", title: "Notif globale" },
  ] });
  const listX = await listNotifications(sharedUser, { schoolId: ctxX.schoolId, take: 50 });
  check("école X voit X + globale, pas Y", listX.length === 2 && !listX.some((n) => n.title === "Notif Y"));
  check("unreadCount scopé X = 2", (await unreadCount(sharedUser, ctxX.schoolId)) === 2);
  check("unreadCount non scopé = 3", (await unreadCount(sharedUser)) === 3);
  await markAllRead(sharedUser, ctxX.schoolId);
  const restY = await listNotifications(sharedUser, { schoolId: ctxY.schoolId, unreadOnly: true, take: 50 });
  check("markAllRead X n'a pas lu les notifs de Y", restY.length === 1 && restY[0].title === "Notif Y");

  // ========== S-D : M8 assiduité → paie ==========
  console.log("== S-D : M8 congés UNPAID + absences → brut ==");
  const ctxD = await mk("D", ["hr.manage", "hr.read", "payroll.manage", "payroll.read"]);
  await installStarterPlan(ctxD);
  await openExercise(ctxD, { name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") });
  await setAttendanceConfig(ctxD, { workdaysPerMonth: 30, prorateUnpaidLeave: true, prorateAbsences: false });
  const ed = await createEmployee(ctxD, { matricule: "D1", firstName: "S", lastName: "A", category: "TEACHING" });
  const empD = ed.ok ? ed.result.id : "";
  await createContract(ctxD, empD, { type: "CDI", position: "Prof", startDate: new Date("2026-01-01"), baseSalary: 90000, activate: true });
  // Congé UNPAID approuvé du 5 au 9 mars (5 jours) — pas de solde requis pour UNPAID
  const lv = await requestLeave(ctxD, empD, { type: "UNPAID", startDate: new Date("2026-03-05"), endDate: new Date("2026-03-09") });
  check("congé UNPAID créé", lv.ok === true);
  const dec = lv.ok ? await decideLeave(ctxD, lv.result.id, true) : { ok: false };
  check("UNPAID approuvé sans solde", dec.ok === true);
  await markAttendance(ctxD, empD, new Date("2026-03-12"), "ABSENT");
  const runD = await createRun(ctxD, { periodStart: new Date("2026-03-01"), periodEnd: new Date("2026-03-31") });
  check("run D créé", runD.ok === true);
  const comp = runD.ok ? await computeRun(ctxD, runD.result.id) : { ok: false };
  check("compute ok", comp.ok === true);
  const runDet = runD.ok ? await getRun(ctxD, runD.result.id) : null;
  const slipD = runDet?.ok ? runDet.result.payslips[0] : null;
  check("5 j non payés → déduction 15 000 (90 000×5/30)", (slipD?.deductions ?? 0) === 15000);
  check("unpaidDays=5 tracé sur le bulletin", slipD?.unpaidDays === 5 && slipD?.daysWorked === 25);
  check("ligne ABS_NP présente", ((slipD?.lines as { code: string }[]) ?? []).some((l) => l.code === "ABS_NP"));
  // prorateAbsences activé → l'absence pointée du 12/03 ajoute 1 j
  await setAttendanceConfig(ctxD, { workdaysPerMonth: 30, prorateUnpaidLeave: true, prorateAbsences: true });
  const comp2 = runD.ok ? await computeRun(ctxD, runD.result.id) : { ok: false };
  check("recalcul DRAFT ok", comp2.ok === true);
  const runDet2 = runD.ok ? await getRun(ctxD, runD.result.id) : null;
  const slipD2 = runDet2?.ok ? runDet2.result.payslips[0] : null;
  check("absence pointée comptée : unpaidDays=6, déduction 18 000", slipD2?.unpaidDays === 6 && (slipD2?.deductions ?? 0) === 18000);
  // prorata UNPAID désactivé + absences désactivées → brut plein
  await setAttendanceConfig(ctxD, { workdaysPerMonth: 30, prorateUnpaidLeave: false, prorateAbsences: false });
  await computeRun(ctxD, runD.ok ? runD.result.id : "");
  const runDet3 = runD.ok ? await getRun(ctxD, runD.result.id) : null;
  const slipD3 = runDet3?.ok ? runDet3.result.payslips[0] : null;
  check("config OFF → aucune déduction assiduité", (slipD3?.deductions ?? -1) === 0 && slipD3?.unpaidDays === 0);

  // ========== S-E : M10 enrollment → créances ==========
  console.log("== S-E : M10 /app/enrollments génère les créances ==");
  const ctxE = await mk("E", ["enrollment.manage", "finance.manage"]);
  const yearE = await prisma.academicYear.create({ data: { schoolId: ctxE.schoolId, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), isCurrent: true } });
  const lvl = await prisma.level.create({ data: { schoolId: ctxE.schoolId, name: "6e", order: 1 } });
  const cls = await prisma.classroom.create({ data: { schoolId: ctxE.schoolId, academicYearId: yearE.id, levelId: lvl.id, name: "6e A" } });
  const catE = await prisma.feeCategory.create({ data: { schoolId: ctxE.schoolId, code: "SCOL", label: "Scolarité" } });
  await prisma.feeTariff.create({ data: { schoolId: ctxE.schoolId, academicYearId: yearE.id, categoryId: catE.id, levelId: lvl.id, amount: 45000, mandatory: true, status: "ACTIVE" } });
  const stE = await prisma.student.create({ data: { schoolId: ctxE.schoolId, matricule: "SE1", firstName: "N", lastName: "E", birthDate: new Date("2013-01-01") } });
  const enr = await enrollStudent(ctxE, { studentId: stE.id, classroomId: cls.id, academicYearId: yearE.id });
  check("inscription ok", enr.ok === true);
  const chargesE = await prisma.studentFeeCharge.count({ where: { schoolId: ctxE.schoolId, studentId: stE.id } });
  check("créance obligatoire générée par enrollStudent", chargesE === 1);
  // Idempotence : un second appel de génération ne double pas
  await generateStudentCharges(ctxE, { studentId: stE.id, academicYearId: yearE.id });
  check("régénération idempotente (toujours 1 créance)", (await prisma.studentFeeCharge.count({ where: { schoolId: ctxE.schoolId, studentId: stE.id } })) === 1);

  // ========== S-F : M11 écritures manuelles ==========
  console.log("== S-F : M11 validation createManualEntry ==");
  const ctxF = await mk("F", ["accounting.manage", "accounting.read"]);
  await installStarterPlan(ctxF);
  const exF = await prisma.accountingExercise.create({ data: { schoolId: ctxF.schoolId, name: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
  const jourOD = await prisma.accountingJournal.findFirstOrThrow({ where: { schoolId: ctxF.schoolId, code: "OD" } });
  const a571 = await accOfF(ctxF.schoolId, "571").catch(() => accOfF(ctxF.schoolId, "57"));
  const a706 = await accOfF(ctxF.schoolId, "706").catch(() => accOfF(ctxF.schoolId, "70"));
  const mkEntry = (lines: { accountId: string; debit?: number; credit?: number }[]) =>
    createManualEntry(ctxF, { journalId: jourOD.id, exerciseId: exF.id, date: new Date("2026-05-01"), description: "t", lines });
  check("débit négatif → INVALID_INPUT", !(await mkEntry([{ accountId: a571.id, debit: -100 }, { accountId: a706.id, credit: 100 }])).ok);
  check("débit+crédit même ligne → INVALID_INPUT", !(await mkEntry([{ accountId: a571.id, debit: 100, credit: 50 }, { accountId: a706.id, credit: 100 }])).ok);
  check("ligne ni débit ni crédit → INVALID_INPUT", !(await mkEntry([{ accountId: a571.id }, { accountId: a706.id, credit: 100 }])).ok);
  check("écriture valide acceptée", (await mkEntry([{ accountId: a571.id, debit: 100 }, { accountId: a706.id, credit: 100 }])).ok === true);

  // ========== S-G : M1 legacy + cancelPayment remboursé ==========
  console.log("== S-G : M1 paiement legacy, annulation remboursée ==");
  // Paiement « legacy » sans empreinte (avant M1) → comparaison champs
  const legacy = await prisma.payment.create({
    data: { schoolId: ctxA.schoolId, studentId: st.id, academicYearId: year.id, amount: 5000, method: "CASH", status: "VALIDATED", receiptNumber: "REC-LG-1", idempotencyKey: "K-LEGACY" },
  });
  const legSame = await recordPayment(ctxA, { studentId: st.id, academicYearId: year.id, amount: 5000, method: "CASH", idempotencyKey: "K-LEGACY" });
  check("legacy même payload → paiement d'origine", legSame.ok === true && legSame.result.id === legacy.id);
  const legDiff = await recordPayment(ctxA, { studentId: st.id, academicYearId: year.id, amount: 7000, method: "CASH", idempotencyKey: "K-LEGACY" });
  check("legacy payload différent → IDEMPOTENCY_CONFLICT", !legDiff.ok && legDiff.error === "IDEMPOTENCY_CONFLICT");
  // Annulation après remboursement confirmé → REFUNDED
  await prisma.paymentRefund.create({ data: { schoolId: ctxA.schoolId, paymentId: legacy.id, amount: 2000, reason: "t", status: "CONFIRMED", confirmedAt: new Date(), requestedById: ctxA.userId, idempotencyKey: `RF-${ts}` } });
  const cx = await cancelPayment(ctxA, { paymentId: legacy.id, reason: "test" });
  check("annulation paiement remboursé → REFUNDED", !cx.ok && cx.error === "REFUNDED");

  console.log(`\n=== STABILISATION : ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

async function accOfF(schoolId: string, code: string) {
  return prisma.accountingAccount.findFirstOrThrow({ where: { schoolId, code } });
}

main().catch((e) => { console.error(e); process.exit(1); });
