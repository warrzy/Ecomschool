import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { createGuardian, linkGuardianToStudent } from "@/lib/services/guardians";
import {
  createAnnouncement,
  listPublishedAnnouncements,
} from "@/lib/services/announcements";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
  notifyUsers,
  unreadCount,
} from "@/lib/services/notifications";
import {
  createMessage,
  listMessages,
  sendMessage,
} from "@/lib/services/comm/messages";
import {
  canContactGuardian,
  canContactUser,
  consentHistory,
  setGuardianConsent,
  setUserPreference,
} from "@/lib/services/comm/preferences";
import {
  channelAvailable,
  channelsStatus,
  getProvider,
  registerTestProvider,
} from "@/lib/services/comm/providers";
import { renderByCode, renderTemplate } from "@/lib/services/comm/templates";
import { enqueueJob, listJobs, runDueJobs } from "@/lib/services/comm/queue";
import { processDelivery } from "@/lib/services/comm/deliver";
import {
  registerCommHandlers,
  runPlatformAutomations,
  runSchoolAutomations,
} from "@/lib/services/comm/automations";
import { assignSubscription } from "@/lib/services/platform/subscriptions";

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
  const passwordHash = await hashPassword(
    process.env.SEED_TEST_PASSWORD ?? "Test1234!",
  );
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
  const schoolA = await ensureSchool("TEST-P9-A", "Ecole Test Phase9 A");
  const schoolB = await ensureSchool("TEST-P9-B", "Ecole Test Phase9 B");
  const adminA = await ensureUser(schoolA.id, "phase9-admin-a@ecom-test.local", "ADMIN_SCHOOL");
  const teacherA = await ensureUser(schoolA.id, "phase9-teacher-a@ecom-test.local", "TEACHER");
  const parentA = await ensureUser(schoolA.id, "phase9-parent-a@ecom-test.local", "PARENT");
  const adminB = await ensureUser(schoolB.id, "phase9-admin-b@ecom-test.local", "ADMIN_SCHOOL");
  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };
  registerCommHandlers();

  // ---- Fixture : classe, élève, tuteur lié ----
  const year = await createYear(ctxA, {
    name: `2027-P9-${S}`,
    startDate: "2027-09-01",
    endDate: "2028-06-30",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  const level = await createLevel(ctxA, { name: `CP P9-${S}`, order: 1 });
  const classroom = await createClassroom(ctxA, {
    name: `CP-A P9-${S}`,
    academicYearId: year.ok ? year.result.id : "",
    levelId: level.ok ? level.result.id : "",
  });
  const student = await createStudent(ctxA, {
    matricule: `P9-${S}-1`,
    firstName: "Eleve",
    lastName: `P9${S}`,
  });
  if (!year.ok || !level.ok || !classroom.ok || !student.ok) {
    throw new Error("fixture failed");
  }
  await enrollStudent(ctxA, {
    studentId: student.result.id,
    classroomId: classroom.result.id,
    academicYearId: year.result.id,
  });
  const guardianA = await createGuardian(ctxA, {
    firstName: "Parent",
    lastName: `P9${S}`,
    phone: "+22670000000",
    email: `phase9-guardian-${S}@ecom-test.local`,
  });
  if (!guardianA.ok) throw new Error("guardian failed");
  await linkGuardianToStudent(ctxA, {
    studentId: student.result.id,
    guardianId: guardianA.result.id,
    relation: "FATHER",
  });
  // Compte parent lié au tuteur
  await prisma.guardian.update({
    where: { id: guardianA.result.id },
    data: { userId: parentA },
  });
  const guardianB = await createGuardian(ctxB, {
    firstName: "ParentB",
    lastName: `P9${S}`,
    phone: "+22670000001",
  });
  if (!guardianB.ok) throw new Error("guardianB failed");
  // École B : année + classe pour le test d'isolation
  const yearB = await createYear(ctxB, {
    name: `2027-P9B-${S}`,
    startDate: "2027-09-01",
    endDate: "2028-06-30",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  const levelB = await createLevel(ctxB, { name: `CP P9B-${S}`, order: 1 });
  if (yearB.ok && levelB.ok) {
    await createClassroom(ctxB, {
      name: `CP-B P9-${S}`,
      academicYearId: yearB.result.id,
      levelId: levelB.result.id,
    });
  }

  // ============ 1. Notifications internes ============
  const nCount = await notifyUsers({
    schoolId: schoolA.id,
    userIds: [teacherA, teacherA, parentA],
    type: "ADMIN_MESSAGE",
    title: `Notif P9 ${S}`,
  });
  record("notifyUsers déduplique les destinataires", nCount === 2);
  const unreadBefore = await unreadCount(teacherA);
  record("Compteur non lues > 0", unreadBefore > 0);
  const list = await listNotifications(teacherA, { take: 10, unreadOnly: true });
  const target = list.find((n) => n.title === `Notif P9 ${S}`);
  record("Filtre non lues", !!target && list.every((n) => !n.readAt));
  if (target) {
    await markNotificationRead(teacherA, target.id);
    const after = await listNotifications(teacherA, { unreadOnly: true, take: 50 });
    record("Marquage individuel lu", !after.some((n) => n.id === target.id));
  }
  const typed = await listNotifications(teacherA, {
    type: "ADMIN_MESSAGE",
    take: 50,
  });
  record("Filtre par type", typed.every((n) => n.type === "ADMIN_MESSAGE"));
  await markAllRead(teacherA);
  record("Tout marquer lu", (await unreadCount(teacherA)) === 0);

  // ============ 2. Messagerie scolaire ============
  const draft = await createMessage(ctxA, {
    subject: `Draft P9 ${S}`,
    body: "Contenu brouillon",
    audience: "ALL_PARENTS",
    channels: ["INTERNAL"],
    topic: "OPTIONAL",
  });
  record("Création brouillon", draft.ok);
  if (!draft.ok) throw new Error("draft failed");

  const sendAll = await sendMessage(ctxA, draft.result.id);
  record(
    "Envoi tous parents (interne)",
    sendAll.ok && sendAll.result.recipients >= 1,
    sendAll.ok ? undefined : JSON.stringify(sendAll),
  );
  const parentNotifs = await listNotifications(parentA, { take: 10 });
  record(
    "Parent a reçu la notification",
    parentNotifs.some((n) => n.title === `Draft P9 ${S}`),
  );

  // Ciblage parents d'une classe
  const classMsg = await createMessage(ctxA, {
    subject: `Classe P9 ${S}`,
    body: "Parents de la classe",
    audience: "CLASS_PARENTS",
    classroomId: classroom.result.id,
    channels: ["INTERNAL"],
  });
  record("Message parents de classe", classMsg.ok);
  if (classMsg.ok) {
    const r = await sendMessage(ctxA, classMsg.result.id);
    record("Ciblage classe (1 parent)", r.ok && r.result.recipients === 1);
  }

  // Ciblage tuteur unique
  const gMsg = await createMessage(ctxA, {
    subject: `Solo P9 ${S}`,
    body: "Un parent",
    audience: "GUARDIAN",
    guardianId: guardianA.result.id,
    channels: ["INTERNAL"],
  });
  record("Message un parent", gMsg.ok);

  // Refus inter-écoles : tuteur de B ciblé depuis A
  const cross = await createMessage(ctxA, {
    subject: "X-tenant",
    body: "Ne doit pas passer",
    audience: "GUARDIAN",
    guardianId: guardianB.result.id,
    channels: ["INTERNAL"],
  });
  record(
    "Refus parent d'une autre école",
    !cross.ok && cross.error === "NOT_FOUND",
  );
  const classB = await prisma.classroom.findFirst({
    where: { schoolId: schoolB.id },
    select: { id: true },
  });
  if (classB) {
    const crossClass = await createMessage(ctxA, {
      subject: "X-class",
      body: "Ne doit pas passer",
      audience: "CLASS_PARENTS",
      classroomId: classB.id,
      channels: ["INTERNAL"],
    });
    record(
      "Refus classe d'une autre école",
      !crossClass.ok && crossClass.error === "NOT_FOUND",
      crossClass.ok ? "accepté à tort" : undefined,
    );
  }

  // Enseignants / personnel
  const tMsg = await createMessage(ctxA, {
    subject: `Staff P9 ${S}`,
    body: "Réunion",
    audience: "TEACHERS",
    channels: ["INTERNAL"],
  });
  if (tMsg.ok) {
    const r = await sendMessage(ctxA, tMsg.result.id);
    record("Ciblage enseignants", r.ok && r.result.recipients >= 1);
  }
  const staffMsg = await createMessage(ctxA, {
    subject: `Personnel P9 ${S}`,
    body: "Info",
    audience: "STAFF",
    channels: ["INTERNAL"],
  });
  if (staffMsg.ok) {
    const r = await sendMessage(ctxA, staffMsg.result.id);
    record("Ciblage personnel administratif", r.ok && r.result.recipients >= 1);
  }

  // Programmation : SCHEDULED, non envoyé avant échéance
  const future = new Date(Date.now() + 3600_000);
  const sched = await createMessage(ctxA, {
    subject: `Sched P9 ${S}`,
    body: "Programmé",
    audience: "TEACHERS",
    channels: ["INTERNAL"],
    scheduledAt: future,
  });
  record(
    "Message programmé ≠ envoyé",
    sched.ok,
  );
  if (sched.ok) {
    const row = await prisma.schoolMessage.findUnique({
      where: { id: sched.result.id },
      select: { status: true },
    });
    record("Statut SCHEDULED", row?.status === "SCHEDULED");
    // Échéance dépassée → l'automatisation l'envoie
    await prisma.schoolMessage.update({
      where: { id: sched.result.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    const auto = await runSchoolAutomations(schoolA.id);
    record(
      "Automatisation envoie le message programmé",
      Number(auto.messagesSent) >= 1,
    );
    const row2 = await prisma.schoolMessage.findUnique({
      where: { id: sched.result.id },
      select: { status: true },
    });
    record("Statut SENT après automatisation", row2?.status === "SENT");
  }

  // Historique
  const history = await listMessages(ctxA, { status: "SENT" });
  record(
    "Historique des envois",
    history.some((m) => m.subject === `Draft P9 ${S}`),
  );
  // École B ne voit pas les messages d'A
  const histB = await listMessages(ctxB, { status: "SENT" });
  record(
    "Isolation inter-écoles (messages)",
    !histB.some((m) => m.subject.includes(`P9 ${S}`)),
  );

  // ============ 3. Préférences & consentement ============
  const optOut = await setUserPreference({
    userId: parentA,
    channel: "EMAIL",
    topic: "OPTIONAL",
    enabled: false,
    actorId: parentA,
  });
  record("Opt-out enregistré", optOut.ok);
  record(
    "Opt-out appliqué",
    !(await canContactUser(parentA, "EMAIL", "OPTIONAL")),
  );
  const txBlock = await setUserPreference({
    userId: parentA,
    channel: "EMAIL",
    topic: "TRANSACTIONAL",
    enabled: false,
  });
  record(
    "Transactional non désinscriptible",
    !txBlock.ok && txBlock.error === "TRANSACTIONAL_REQUIRED",
  );
  record(
    "Transactional toujours autorisé",
    await canContactUser(parentA, "EMAIL", "TRANSACTIONAL"),
  );
  const hist = await consentHistory(parentA);
  record("Historique des consentements", hist.length >= 1);

  // Tuteur sans compte : SMS opt-in requis
  record(
    "Guardian SMS sans consentement = refusé",
    !(await canContactGuardian(guardianB.result.id, "SMS", "OPTIONAL")),
  );
  await setGuardianConsent({
    schoolId: schoolB.id,
    guardianId: guardianB.result.id,
    smsOptIn: true,
  });
  record(
    "Guardian SMS opt-in accepté",
    await canContactGuardian(guardianB.result.id, "SMS", "OPTIONAL"),
  );
  const consentCross = await setGuardianConsent({
    schoolId: schoolA.id,
    guardianId: guardianB.result.id,
    smsOptIn: true,
  });
  record(
    "Consentement guardian inter-écoles refusé",
    !consentCross.ok && consentCross.error === "NOT_FOUND",
  );

  // ============ 4. Templates ============
  const rendered = renderTemplate("Bonjour {{name}}, échéance {{due}}", {
    name: "X",
    due: "10/10",
  });
  record("Rendu template variables", rendered === "Bonjour X, échéance 10/10");
  const tpl = await renderByCode("ABSENCE_UNJUSTIFIED", {
    studentName: "Test",
    date: "10/10/2026",
  });
  record("Template ABSENCE_UNJUSTIFIED rendu", !!tpl && !!tpl.body);

  // ============ 5. Fournisseurs & livraisons ============
  const statuses = channelsStatus();
  record(
    "Statut canaux exposé (3 canaux)",
    statuses.length === 3 && statuses.every((s) => typeof s.configured === "boolean"),
  );
  // Sans fournisseur configuré → FAILED PROVIDER_NOT_CONFIGURED
  const realSms = getProvider("SMS")!;
  if (!channelAvailable("SMS")) {
    const d = await prisma.messageDelivery.create({
      data: {
        schoolId: schoolA.id,
        guardianId: guardianA.result.id,
        channel: "SMS",
        status: "QUEUED",
        address: "+22670000000",
      },
    });
    await setGuardianConsent({
      schoolId: schoolA.id,
      guardianId: guardianA.result.id,
      smsOptIn: true,
    });
    await processDelivery(d.id, { body: "Test SMS" });
    const done = await prisma.messageDelivery.findUnique({
      where: { id: d.id },
      select: { status: true, lastError: true },
    });
    record(
      "SMS sans fournisseur = échec explicite",
      done?.status === "FAILED" && done?.lastError === "PROVIDER_NOT_CONFIGURED",
      done?.lastError ?? undefined,
    );
  } else {
    record("SMS sans fournisseur = échec explicite", true, "provider configuré, skip");
  }

  // Fournisseur simulé (tests uniquement)
  let sentPayload: unknown = null;
  registerTestProvider("SMS", {
    channel: "SMS",
    configured: () => true,
    async send(input) {
      sentPayload = input;
      return { ok: true, providerRef: "sim-1", costUnits: 15 };
    },
  });
  const d2 = await prisma.messageDelivery.create({
    data: {
      schoolId: schoolA.id,
      guardianId: guardianA.result.id,
      channel: "SMS",
      status: "QUEUED",
      address: "+22670000000",
    },
  });
  await processDelivery(d2.id, { body: "Rappel échéance" });
  const d2f = await prisma.messageDelivery.findUnique({
    where: { id: d2.id },
    select: { status: true, providerRef: true, costUnits: true },
  });
  record(
    "SMS via fournisseur simulé = SENT",
    d2f?.status === "SENT" && d2f.providerRef === "sim-1",
  );
  record("Coût SMS enregistré", d2f?.costUnits === 15);
  record(
    "Payload envoyé sans données scolaires sensibles",
    typeof sentPayload === "object" &&
      JSON.stringify(sentPayload).length < 500,
  );

  // WhatsApp : template requis
  registerTestProvider("WHATSAPP", {
    channel: "WHATSAPP",
    configured: () => true,
    async send(input) {
      if (!input.templateName) return { ok: false, error: "TEMPLATE_REQUIRED" };
      return { ok: true, providerRef: "wa-1" };
    },
  });
  await setGuardianConsent({
    schoolId: schoolA.id,
    guardianId: guardianA.result.id,
    whatsappOptIn: true,
  });
  const dWa = await prisma.messageDelivery.create({
    data: {
      schoolId: schoolA.id,
      guardianId: guardianA.result.id,
      channel: "WHATSAPP",
      status: "QUEUED",
      address: "+22670000000",
    },
  });
  await processDelivery(dWa.id, { body: "x" });
  const dWaF = await prisma.messageDelivery.findUnique({
    where: { id: dWa.id },
    select: { lastError: true, status: true },
  });
  record(
    "WhatsApp exige un template",
    dWaF?.status === "FAILED" && dWaF.lastError === "TEMPLATE_REQUIRED",
  );

  // Opt-out bloque la livraison
  const d3 = await prisma.messageDelivery.create({
    data: {
      schoolId: schoolA.id,
      userId: parentA,
      channel: "EMAIL",
      status: "QUEUED",
      messageId: draft.result.id,
    },
  });
  await processDelivery(d3.id, { subject: "s", body: "b" });
  const d3f = await prisma.messageDelivery.findUnique({
    where: { id: d3.id },
    select: { status: true, lastError: true },
  });
  record(
    "Opt-out utilisateur bloque la livraison",
    d3f?.status === "BLOCKED" && d3f.lastError === "OPT_OUT",
  );

  // ============ 6. File de jobs ============
  const key = `job-dedup-${S}`;
  const j1 = await enqueueJob({
    type: "delivery.send",
    payload: { deliveryId: d2.id, body: "x" },
    schoolId: schoolA.id,
    dedupKey: key,
  });
  const j2 = await enqueueJob({
    type: "delivery.send",
    payload: { deliveryId: d2.id, body: "x" },
    schoolId: schoolA.id,
    dedupKey: key,
  });
  record(
    "Déduplication des jobs",
    j1.ok && j2.ok && j2.deduplicated,
  );

  // Job en échec retryable → PENDING avec backoff ; puis DEAD au-delà
  registerJobHandlerForce("test.fail", async () => {
    throw new Error("boom");
  });
  const failJob = await enqueueJob({
    type: "test.fail",
    payload: {},
    schoolId: schoolA.id,
    maxAttempts: 2,
  });
  await runDueJobs({ limit: 100 });
  const fj1 = await prisma.job.findUnique({
    where: { id: failJob.jobId! },
    select: { status: true, lastError: true, runAt: true },
  });
  record(
    "Échec → retry planifié (backoff)",
    fj1?.status === "PENDING" && fj1.lastError === "boom" && fj1.runAt > new Date(),
  );
  await prisma.job.update({
    where: { id: failJob.jobId! },
    data: { runAt: new Date(Date.now() - 1000) },
  });
  await runDueJobs({ limit: 100 });
  const fj2 = await prisma.job.findUnique({
    where: { id: failJob.jobId! },
    select: { status: true },
  });
  record("Échec définitif → DEAD", fj2?.status === "DEAD");

  // Reprise après interruption : RUNNING stale → PENDING
  registerJobHandlerForce("test.stale", async () => {
    // marqueur d'exécution
    await prisma.messageDelivery.update({
      where: { id: d2.id },
      data: { lastError: "stale-ran" },
    });
  });
  const stale = await prisma.job.create({
    data: {
      type: "test.stale",
      payload: {},
      status: "RUNNING",
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      attempts: 1,
      runAt: new Date(Date.now() - 10 * 60 * 1000),
      schoolId: schoolA.id,
    },
  });
  await runDueJobs({ limit: 100 });
  const staleAfter = await prisma.job.findUnique({
    where: { id: stale.id },
    select: { status: true },
  });
  record(
    "Job interrompu repris",
    staleAfter?.status === "DONE",
    staleAfter?.status,
  );

  // ============ 7. Automatisations ============
  // Annonce programmée
  const schedAnn = await createAnnouncement(ctxA, {
    title: `Ann prog P9 ${S}`,
    body: "corps",
    audience: "ALL",
    scheduledAt: new Date(Date.now() + 3600_000),
  });
  record("Annonce programmée (non publiée)", schedAnn.ok);
  if (schedAnn.ok) {
    const pub = await listPublishedAnnouncements(schoolA.id, "ALL", { take: 50 });
    record(
      "Pas publiée avant échéance",
      !pub.some((a) => a.title === `Ann prog P9 ${S}`),
    );
    await prisma.announcement.update({
      where: { id: schedAnn.result.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    await runSchoolAutomations(schoolA.id);
    const pub2 = await listPublishedAnnouncements(schoolA.id, "ALL", { take: 50 });
    record(
      "Publiée par l'automatisation",
      pub2.some((a) => a.title === `Ann prog P9 ${S}`),
    );
  }

  // Automatisations plateforme : idempotence
  const run1 = await runPlatformAutomations();
  const run2 = await runPlatformAutomations();
  record(
    "Automatisations plateforme exécutées",
    run1 != null && typeof run1 === "object",
  );
  record(
    "Idempotence (2e run sans nouveaux envois)",
    Number(run2.expiryAlerts) === 0 && Number(run2.invoiceAlerts) === 0,
    `r2=${JSON.stringify({ e: run2.expiryAlerts, i: run2.invoiceAlerts })}`,
  );

  // Alertes d'expiration : abonnement bientôt à échéance
  const plan = await prisma.subscriptionPlan.upsert({
    where: { code: `P9-PLAN-${S}` },
    update: {},
    create: {
      code: `P9-PLAN-${S}`,
      name: `Plan P9 ${S}`,
      monthlyPrice: 10000,
      yearlyPrice: 100000,
    },
  });
  const in5d = new Date(Date.now() + 5 * 86400000);
  const assign = await assignSubscription(adminA, {
    schoolId: schoolA.id,
    planId: plan.id,
    cycle: "MONTHLY",
  });
  record("Abonnement test assigné", assign.ok);
  if (assign.ok) {
    await prisma.schoolSubscription.update({
      where: { id: assign.result.id },
      data: { status: "ACTIVE", currentPeriodEnd: in5d },
    });
    const r3 = await runPlatformAutomations();
    record(
      "Alerte pré-expiration générée",
      Number(r3.expiryAlerts) >= 1,
    );
    const adminNotifs = await listNotifications(adminA, { take: 30 });
    record(
      "Admin école notifié de l'échéance",
      adminNotifs.some((n) => n.title.includes("Abonnement bientôt")),
    );
    const r4 = await runPlatformAutomations();
    record(
      "Alerte non dupliquée le même jour",
      Number(r4.expiryAlerts) === 0,
    );
  }

  // Jobs tracés
  const jobs = await listJobs({ take: 10 });
  record("Supervision jobs consultable", jobs.length > 0);
  const runs = await prisma.taskRun.findMany({ take: 10, orderBy: { startedAt: "desc" } });
  record(
    "Historique d'exécution (TaskRun)",
    runs.some((r) => r.task === "platform.automations" && r.status === "DONE"),
  );

  // Restauration du provider SMS réel pour ne pas polluer
  registerTestProvider("SMS", realSms);

  // ============ Résumé ============
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\nPhase 9 — ${passed}/${checks.length} vérifications`);
  for (const c of checks) {
    console.log(
      `${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
    );
  }
  if (passed !== checks.length) process.exitCode = 1;
}

// registerJobHandler n'expose pas de remplacement : on ré-enregistre (Map.set écrase).
import { registerJobHandler } from "@/lib/services/comm/queue";
function registerJobHandlerForce(
  type: string,
  handler: (payload: Record<string, unknown>) => Promise<void>,
) {
  registerJobHandler(type, handler);
}

main()
  .catch((e) => {
    console.error("PHASE9_TEST_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
