/**
 * Recette E2E HTTP G3-C — parcours réellement accessible au parent.
 *
 * Contrairement à la recette service (payments-g3c-recette.ts), ce
 * script passe par HTTP : authentification NextAuth réelle, rendu des
 * pages /parent, soumission du formulaire de paiement via l'action
 * serveur progressive ($ACTION_ID), page de suivi, route PDF des
 * reçus, refus d'accès. La confirmation du paiement reste au niveau
 * service (pollPaymentIntent) — c'est le rôle du prestataire/cron.
 *
 * Usage : BASE_URL=http://127.0.0.1:3001 npx tsx scripts/g3/payments-g3c-e2e-http.ts
 *         E2E_CLEANUP=1 … (supprime les fixtures à la fin)
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";
import { recordPayment } from "../../src/lib/services/finance/payments";
import { pollPaymentIntent } from "../../src/lib/services/payments/mobileIntents";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const PASSWORD = "G3c-E2e-Parent-2026!";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G3C-E2E";
const EMAIL = "g3c-e2e-parent@test.local";
const EMAIL2 = "g3c-e2e-other@test.local";

async function cleanup(schoolId: string) {
  await prisma.paymentDiscrepancy.deleteMany({ where: { schoolId } });
  await prisma.paymentReconciliation.deleteMany({ where: { schoolId } });
  await prisma.paymentRefund.deleteMany({ where: { schoolId } });
  await prisma.paymentSettlement.deleteMany({ where: { schoolId } });
  await prisma.webhookEvent.deleteMany({ where: { schoolId } });
  await prisma.job.deleteMany({ where: { schoolId } });
  await prisma.paymentTransaction.deleteMany({ where: { schoolId } });
  await prisma.paymentIntent.deleteMany({ where: { schoolId } });
  await prisma.paymentProvider.deleteMany({ where: { schoolId } });
  await prisma.paymentAllocation.deleteMany({ where: { installment: { schoolId } } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

/** Mini client HTTP avec jar de cookies. */
function makeClient() {
  const jar = new Map<string, string>();
  const readCookies = (res: Response) => {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    jar,
    async get(path: string) {
      const res = await fetch(`${BASE}${path}`, {
        headers: { cookie: cookieHeader() },
        redirect: "manual",
      });
      readCookies(res);
      return res;
    },
    async post(path: string, body: URLSearchParams, extra: Record<string, string> = {}) {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
          cookie: cookieHeader(),
          "content-type": "application/x-www-form-urlencoded",
          ...extra,
        },
        body: body.toString(),
        redirect: "manual",
      });
      readCookies(res);
      return res;
    },
    /** POST multipart — format réel des formulaires MPA (sans JS). */
    async postForm(path: string, fields: Record<string, string>) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { cookie: cookieHeader() },
        body: fd,
        redirect: "manual",
      });
      readCookies(res);
      return res;
    },
  };
}

/** Extrait les champs cachés `$ACTION_ID…` d'un formulaire rendu. */
function extractActionIds(html: string) {
  const ids = [...html.matchAll(/name="(\$ACTION_ID_[0-9a-f]+)"/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

async function main() {
  // ---------- Fixtures ----------
  const old = await prisma.school.findFirst({ where: { name: FX }, select: { id: true } });
  if (old) await cleanup(old.id);
  const stale = await prisma.user.findMany({
    where: { email: { in: [EMAIL, EMAIL2] } }, select: { id: true },
  });
  if (stale.length) {
    await prisma.guardian.updateMany({ where: { userId: { in: stale.map((u) => u.id) } }, data: { userId: null } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g3c-e2e" } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e" } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, name: "6e A", academicYearId: year.id, levelId: level.id },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const provider = await prisma.paymentProvider.create({
    data: { schoolId: school.id, code: "SANDBOX", label: "Simu E2E", mode: "SANDBOX" },
  });

  const mkStudent = async (mat: string) => {
    const s = await prisma.student.create({
      data: { schoolId: school.id, matricule: mat, firstName: "Enfant", lastName: mat, status: "ACTIVE" },
    });
    await prisma.enrollment.create({
      data: { schoolId: school.id, studentId: s.id, academicYearId: year.id, classroomId: classroom.id, status: "ENROLLED" },
    });
    return s;
  };
  const mkCharge = async (studentId: string, installments: { amount: number; due: Date; label: string }[]) => {
    const charge = await prisma.studentFeeCharge.create({
      data: {
        schoolId: school.id, studentId, academicYearId: year.id, categoryId: cat.id,
        amount: installments.reduce((s, i) => s + i.amount, 0),
      },
    });
    const out = [];
    for (const i of installments) {
      out.push(await prisma.feeInstallment.create({
        data: {
          schoolId: school.id, chargeId: charge.id, studentId,
          academicYearId: year.id, dueDate: i.due, amount: i.amount, label: i.label,
        },
      }));
    }
    return out;
  };

  const pastDue = new Date(Date.now() - 10 * 86400_000);
  const futureDue = new Date(Date.now() + 30 * 86400_000);

  const s1 = await mkStudent("G3C-E2E-S1");
  const insts1 = await mkCharge(s1.id, [
    { amount: 10_000, due: pastDue, label: "T1" },
    { amount: 10_000, due: futureDue, label: "T2" },
  ]);
  const s2 = await mkStudent("G3C-E2E-S2");
  const insts2 = await mkCharge(s2.id, [{ amount: 5_000, due: pastDue, label: "T1" }]);
  // Enfant d'un autre parent — cible du test d'accès refusé.
  const s3 = await mkStudent("G3C-E2E-S3");
  await mkCharge(s3.id, [{ amount: 3_000, due: futureDue, label: "T1" }]);

  const parent = await prisma.user.create({
    data: {
      email: EMAIL, passwordHash: await hashPassword(PASSWORD),
      firstName: "Parent", lastName: "E2E", status: "ACTIVE",
    },
  });
  const role = await prisma.role.create({ data: { name: "G3C_PARENT", scope: "SCHOOL", schoolId: school.id } });
  const perms = await prisma.permission.findMany({ where: { key: { in: ["portal.parent"] } }, select: { id: true } });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  await prisma.schoolMembership.create({
    data: { userId: parent.id, schoolId: school.id, roleId: role.id, status: "ACTIVE" },
  });
  const guardian = await prisma.guardian.create({
    data: { schoolId: school.id, firstName: "Parent", lastName: "E2E", userId: parent.id, status: "ACTIVE" },
  });
  for (const sid of [s1.id, s2.id]) {
    await prisma.studentGuardian.create({
      data: { schoolId: school.id, studentId: sid, guardianId: guardian.id, relation: "FATHER" },
    });
  }
  // Un reçu réel : paiement guichet sur s2.
  const admin = await prisma.user.create({
    data: {
      email: EMAIL2, passwordHash: await hashPassword(PASSWORD),
      firstName: "Admin", lastName: "E2E", status: "ACTIVE",
    },
  });
  const ctxA = { userId: admin.id, schoolId: school.id };
  const cash = await recordPayment(ctxA, {
    studentId: s2.id, academicYearId: year.id, amount: 5_000,
    method: "CASH", allocations: [{ installmentId: insts2[0].id, amount: 5_000 }],
    idempotencyKey: "g3c-e2e-cash",
  });
  const receiptPaymentId = cash.ok ? cash.result.id : "";

  // ---------- HTTP : connexion ----------
  console.log("\n— Connexion parent (HTTP réel) —");
  const client = makeClient();
  const csrfRes = await client.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json() as { csrfToken: string };
  check("CSRF récupéré", !!csrfToken);
  const login = await client.post("/api/auth/callback/credentials", new URLSearchParams({
    csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE}/parent`,
  }));
  const sessionCookie = [...client.jar.keys()].find((k) => k.includes("session-token"));
  check("connexion parent → session établie", login.status === 302 || login.status === 200, );
  check("cookie de session posé", !!sessionCookie);
  const badLogin = await (async () => {
    const c2 = makeClient();
    const r = await c2.get("/api/auth/csrf");
    const { csrfToken: t2 } = await r.json() as { csrfToken: string };
    const p = await c2.post("/api/auth/callback/credentials", new URLSearchParams({
      csrfToken: t2, email: EMAIL, password: "mauvais-mot-de-passe-1", callbackUrl: `${BASE}/parent`,
    }));
    void p;
    return [...c2.jar.keys()].find((k) => k.includes("session-token"));
  })();
  check("mauvais mot de passe → pas de session", !badLogin);

  // ---------- Rendu des pages ----------
  console.log("\n— Rendu du portail —");
  const home = await client.get("/parent");
  const homeHtml = await home.text();
  check("/parent rendu", home.status === 200);
  check("sélecteur multi-enfants : les deux enfants visibles",
    homeHtml.includes("G3C-E2E-S1") && homeHtml.includes("G3C-E2E-S2"));

  const fin = await client.get(`/parent?child=${s1.id}&tab=finances`);
  const finHtml = await fin.text();
  check("onglet finances rendu", fin.status === 200);
  check("tableau financier : situation affichée", finHtml.includes("Situation financière"));
  check("vue consolidée famille affichée", finHtml.includes("Situation de la famille"));
  check("échéances listées", finHtml.includes("chéance"));
  check("bouton Payer présent (prestataire sandbox dispo)", finHtml.includes("Payer"));

  const payPage = await client.get(`/parent?child=${s1.id}&tab=finances&pay=${insts1[0].id}`);
  const payHtml = await payPage.text();
  check("formulaire de paiement rendu", payPage.status === 200 && payHtml.includes("Payer une"));
  check("solde exigible affiché", payHtml.includes("Solde exigible"));
  check("sélection opérateur présente", payHtml.includes("Simu E2E"));

  // ---------- Soumission du formulaire (action serveur progressive) ----------
  console.log("\n— Initiation du paiement —");
  const actionIds = extractActionIds(payHtml);
  check("action serveur identifiée dans le HTML", actionIds.length > 0);
  const fields: Record<string, string> = {
    studentId: s1.id,
    feeInstallmentId: insts1[0].id,
    amount: "4000",
    providerId: provider.id,
    payerPhone: "+22670000000",
    idempotencyKey: "g3c-e2e-form",
  };
  for (const id of actionIds) fields[id] = "";
  const submit = await client.postForm(
    `/parent?child=${s1.id}&tab=finances&pay=${insts1[0].id}`, fields);
  const loc = submit.headers.get("location") ?? "";
  check("soumission → redirection vers le suivi",
    submit.status === 303 && loc.includes("intent="));
  const intentId = new URLSearchParams(loc.split("?")[1] ?? "").get("intent") ?? "";
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  check("intention créée par l'action serveur (canal parent)",
    !!intent && intent.channel === "PARENT_PORTAL" && intent.amount === 4_000);

  // ---------- Suivi ----------
  console.log("\n— Suivi —");
  const track = await client.get(`/parent?child=${s1.id}&tab=finances&intent=${intentId}`);
  const trackHtml = await track.text();
  check("page de suivi rendue", track.status === 200);
  check("statut affiché en français",
    trackHtml.includes("En attente de confirmation") || trackHtml.includes("Demande créée"));
  check("historique des demandes présent", trackHtml.includes("demandes de paiement"));

  // Confirmation sandbox par le mécanisme central (rôle du prestataire/cron).
  await prisma.paymentIntent.update({
    where: { id: intentId }, data: { sandboxScript: { outcome: "SUCCESS", afterChecks: 0, checks: 0 } },
  });
  const polled = await pollPaymentIntent(ctxA, intentId);
  check("confirmation sandbox via mécanisme central", polled.ok);
  const track2 = await client.get(`/parent?child=${s1.id}&tab=finances&intent=${intentId}`);
  const track2Html = await track2.text();
  check("statut confirmé affiché au parent", track2Html.includes("Paiement confirm"));
  check("aucun encaissement réel pour l'intention sandbox",
    (await prisma.paymentIntent.findUnique({ where: { id: intentId } }))?.paymentId === null &&
    (await prisma.payment.count({ where: { studentId: s1.id, method: "MOBILE_MONEY" } })) === 0);
  check("aucun lien reçu fictif dans le suivi", !track2Html.includes("Reçu PDF"));

  // ---------- Reçus ----------
  console.log("\n— Reçus —");
  const pdf = await client.get(`/parent/receipts/${receiptPaymentId}/pdf`);
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  check("reçu PDF d'un vrai paiement → 200 + %PDF",
    pdf.status === 200 && pdfBuf.subarray(0, 4).toString() === "%PDF");
  const fin2 = await client.get(`/parent?child=${s2.id}&tab=finances`);
  const fin2Html = await fin2.text();
  check("historique/reçu visibles pour l'enfant concerné", fin2Html.includes("Reçu PDF"));

  // Reçu d'un paiement d'un élève non lié → refus.
  const pay3 = await recordPayment(ctxA, {
    studentId: s3.id, academicYearId: year.id, amount: 3_000,
    method: "CASH", allocations: [{ installmentId: (await prisma.feeInstallment.findFirstOrThrow({ where: { studentId: s3.id } })).id, amount: 3_000 }],
    idempotencyKey: "g3c-e2e-cash-s3",
  });
  const pay3id = pay3.ok ? pay3.result.id : "";
  const pdfForbidden = await client.get(`/parent/receipts/${pay3id}/pdf`);
  check("reçu d'un élève non lié → refusé", pdfForbidden.status !== 200);

  // ---------- Accès refusés ----------
  console.log("\n— Accès refusés —");
  const denied = await client.get(`/parent?child=${s3.id}&tab=finances`);
  const deniedHtml = await denied.text();
  check("enfant non lié → accès refusé", deniedHtml.includes("non autoris"));
  // redirect() dans un layout RSC → 200 + instruction de redirection.
  const anon = await fetch(`${BASE}/parent`, { redirect: "manual" });
  const anonBody = await anon.text();
  check("non connecté → redirection login",
    anon.status === 302 || anon.status === 307 ||
    (anonBody.includes("NEXT_REDIRECT") && anonBody.includes("/login")));
  // Un utilisateur sans permission portal.parent.
  const c3 = makeClient();
  const r3 = await c3.get("/api/auth/csrf");
  const { csrfToken: t3 } = await r3.json() as { csrfToken: string };
  await c3.post("/api/auth/callback/credentials", new URLSearchParams({
    csrfToken: t3, email: EMAIL2, password: PASSWORD, callbackUrl: `${BASE}/parent`,
  }));
  const noPerm = await c3.get("/parent");
  const noPermBody = await noPerm.text();
  check("compte sans portal.parent → redirigé",
    noPerm.status === 302 || noPerm.status === 307 ||
    (noPermBody.includes("NEXT_REDIRECT") &&
      (noPermBody.includes("forbidden") || noPermBody.includes("onboarding") || noPermBody.includes("login"))));

  // ---------- Bilan ----------
  console.log(`\n═══ G3-C E2E HTTP : ${pass} PASS / ${fail} FAIL ═══`);

  if (process.env.E2E_CLEANUP === "1") {
    await cleanup(school.id);
    const us = await prisma.user.findMany({
      where: { email: { in: [EMAIL, EMAIL2] } }, select: { id: true },
    });
    if (us.length) {
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
    }
    console.log("Fixtures supprimées.");
  }
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
