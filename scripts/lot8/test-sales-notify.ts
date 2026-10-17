/**
 * Lot 8 — notification WhatsApp aux commerciaux (tests sur base dev locale).
 *
 * Usage : npx tsx scripts/lot8/test-sales-notify.ts
 *
 * Couvre : validation E.164, auto-édition du profil (self only, rôle requis),
 * notification interne de tous les PLATFORM_SALES actifs, livraison WhatsApp
 * conditionnée au numéro valide + consentement, déduplication au rejeu,
 * panne provider non bloquante, opt-out à l'envoi, mode WHATSAPP_DRY_RUN.
 * Aucun appel réseau : le provider n'est jamais configuré ou reste en DRY-RUN.
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { e164Schema } from "@/lib/validations/profile";
import {
  updateOwnWhatsapp,
  userIsPlatformSales,
} from "@/lib/services/platform/profile";
import { createSignupRequest } from "@/lib/services/platform/signup-requests";
import { registerCommHandlers } from "@/lib/services/comm/automations";
import { enqueueJob, runDueJobs } from "@/lib/services/comm/queue";
import {
  createDelivery,
  processDelivery,
} from "@/lib/services/comm/deliver";

const TAG = "lot8-test";
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
let requestId = "";

async function mkUser(suffix: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  const u = await prisma.user.create({
    data: {
      email: `${TAG}-${suffix}@test.local`,
      passwordHash: "x",
      status,
      firstName: suffix,
    },
  });
  createdUserIds.push(u.id);
  return u;
}

async function mkRole(name: string) {
  const existing = await prisma.role.findFirst({
    where: { name, scope: "PLATFORM", schoolId: null },
  });
  if (existing) return existing;
  const r = await prisma.role.create({
    data: { name, scope: "PLATFORM", schoolId: null },
  });
  createdRoleIds.push(r.id);
  return r;
}

async function main() {
  // ---------- 1. Validation E.164 ----------
  check("E.164 valide accepté", e164Schema.safeParse("+22655903205").success);
  check("E.164 sans + refusé", !e164Schema.safeParse("0022655903205").success);
  check("E.164 lettres refusé", !e164Schema.safeParse("+226ABC").success);
  check("E.164 trop court refusé", !e164Schema.safeParse("+1").success);
  check("E.164 commence par 0 refusé", !e164Schema.safeParse("+02265590").success);

  // ---------- Fixtures ----------
  const salesRole = await mkRole("PLATFORM_SALES");
  const otherRole = await mkRole("LOT8_OTHER");
  const [a, b, c, inactive, other] = await Promise.all([
    mkUser("sales-a"),
    mkUser("sales-b"),
    mkUser("sales-c"),
    mkUser("sales-inactive", "DISABLED"),
    mkUser("other"),
  ]);
  for (const [u, r] of [
    [a, salesRole],
    [b, salesRole],
    [c, salesRole],
    [inactive, salesRole],
    [other, otherRole],
  ] as const) {
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
  }

  // ---------- 2. Profil : self-edit + rôle + consentement ----------
  check("PLATFORM_SALES reconnu", await userIsPlatformSales(a.id));
  check("Non-sales refusé", !(await userIsPlatformSales(other.id)));

  const resOther = await updateOwnWhatsapp(other.id, {
    whatsappNumber: "+22670000001",
    whatsappOptIn: true,
  });
  check("Non-sales ne peut pas éditer", !resOther.ok && resOther.error === "FORBIDDEN");

  const resBad = await updateOwnWhatsapp(a.id, {
    whatsappNumber: "06-12-34",
    whatsappOptIn: true,
  });
  check("Format invalide refusé", !resBad.ok && resBad.error === "INVALID_PHONE");

  const resNoPhone = await updateOwnWhatsapp(a.id, {
    whatsappNumber: "",
    whatsappOptIn: true,
  });
  check("Opt-in sans numéro refusé", !resNoPhone.ok && resNoPhone.error === "PHONE_REQUIRED");

  const resA = await updateOwnWhatsapp(a.id, {
    whatsappNumber: "+22655903205",
    whatsappOptIn: true,
  });
  check("Commercial enregistre numéro + opt-in", resA.ok);
  const resB = await updateOwnWhatsapp(b.id, {
    whatsappNumber: "+22670000002",
    whatsappOptIn: false,
  });
  check("Numéro sans consentement accepté", resB.ok);

  // ---------- 3. Demande → job en file ----------
  const req = await createSignupRequest({
    schoolName: `${TAG} École Horizon`,
    city: "Ouagadougou",
    country: "BF",
    contactName: "Directeur Test",
    contactEmail: `${TAG}@ecole.test`,
    planCode: undefined,
  });
  check("Demande enregistrée", req.ok);
  if (!req.ok) throw new Error("createSignupRequest a échoué");
  requestId = req.result.id;
  const job = await prisma.job.findUnique({
    where: { dedupKey: `signup-notify:${requestId}` },
  });
  check("Job sales.signup_notify en file", job?.type === "sales.signup_notify");

  // ---------- 4. Traitement (provider WhatsApp NON configuré) ----------
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_DRY_RUN;
  registerCommHandlers();
  await runDueJobs({ limit: 50 });

  const link = `/platform/signup-requests?demande=${requestId}`;
  const notifs = await prisma.notification.findMany({
    where: { link },
    select: { userId: true },
  });
  const notifUsers = new Set(notifs.map((n) => n.userId));
  check("Notif interne : sales A", notifUsers.has(a.id));
  check("Notif interne : sales B (sans opt-in)", notifUsers.has(b.id));
  check("Notif interne : sales C (sans numéro)", notifUsers.has(c.id));
  check("Pas de notif : sales suspendu", !notifUsers.has(inactive.id));
  check("Pas de notif : autre rôle plateforme", !notifUsers.has(other.id));

  const deliveries = await prisma.messageDelivery.findMany({
    where: { dedupKey: { startsWith: `signup-wa:${requestId}:` } },
  });
  check(
    "1 seule livraison WhatsApp (A seul : numéro + opt-in)",
    deliveries.length === 1 && deliveries[0].userId === a.id,
    `${deliveries.length} livraison(s)`,
  );
  const reqAfter = await prisma.schoolSignupRequest.findUnique({
    where: { id: requestId },
  });
  check("Demande intacte malgré la panne", reqAfter?.status === "PENDING");

  // ---------- 5. Rejeu : aucun doublon ----------
  await enqueueJob({
    type: "sales.signup_notify",
    payload: { requestId },
    dedupKey: `${TAG}-retry:${requestId}`,
  });
  await runDueJobs({ limit: 50 });
  const notifs2 = await prisma.notification.count({ where: { link } });
  const deliveries2 = await prisma.messageDelivery.count({
    where: { dedupKey: { startsWith: `signup-wa:${requestId}:` } },
  });
  check("Rejeu : notifs inchangées", notifs2 === notifs.length, `${notifs2}`);
  check("Rejeu : livraisons inchangées", deliveries2 === 1, `${deliveries2}`);
  const finalDelivery = await prisma.messageDelivery.findUnique({
    where: { id: deliveries[0].id },
  });
  check(
    "Panne provider tracée, non bloquante",
    finalDelivery?.status === "FAILED" &&
      finalDelivery?.lastError === "PROVIDER_NOT_CONFIGURED",
    `${finalDelivery?.status}/${finalDelivery?.lastError}`,
  );

  // ---------- 6. Mode DRY_RUN : aucun appel réseau ----------
  process.env.WHATSAPP_TOKEN = "fake-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "fake-phone-id";
  process.env.WHATSAPP_DRY_RUN = "1";
  const dryId = await createDelivery({
    channel: "WHATSAPP",
    userId: a.id,
    topic: "TRANSACTIONAL",
    dedupKey: `${TAG}-dry:${a.id}`,
    body: "test dry-run",
  });
  await processDelivery(dryId!, { body: "test dry-run" });
  const dry = await prisma.messageDelivery.findUnique({ where: { id: dryId! } });
  check(
    "DRY_RUN : SENT sans réseau (providerRef DRYRUN)",
    dry?.status === "SENT" && dry.providerRef === "DRYRUN",
  );

  // ---------- 7. Opt-out vérifié à l'envoi ----------
  const blockId = await createDelivery({
    channel: "WHATSAPP",
    userId: b.id,
    topic: "TRANSACTIONAL",
    dedupKey: `${TAG}-optout:${b.id}`,
    body: "test opt-out",
  });
  await processDelivery(blockId!, { body: "test opt-out" });
  const blocked = await prisma.messageDelivery.findUnique({
    where: { id: blockId! },
  });
  check(
    "Opt-out à l'envoi → BLOCKED",
    blocked?.status === "BLOCKED" && blocked.lastError === "OPT_OUT",
  );
}

async function cleanup() {
  const deliveries = await prisma.messageDelivery.findMany({
    where: {
      OR: [
        { dedupKey: { startsWith: `signup-wa:${requestId}:` } },
        { dedupKey: { startsWith: `${TAG}-` } },
      ],
    },
    select: { id: true },
  });
  // Jobs delivery.send liés à ces livraisons uniquement.
  for (const d of deliveries) {
    await prisma.job.deleteMany({
      where: {
        type: "delivery.send",
        payload: { path: ["deliveryId"], equals: d.id },
      },
    });
  }
  await prisma.messageDelivery.deleteMany({
    where: { id: { in: deliveries.map((d) => d.id) } },
  });
  await prisma.notification.deleteMany({
    where: { link: `/platform/signup-requests?demande=${requestId}` },
  });
  await prisma.job.deleteMany({
    where: {
      OR: [
        { dedupKey: `signup-notify:${requestId}` },
        { dedupKey: { startsWith: `${TAG}-` } },
      ],
    },
  });
  await prisma.schoolSignupRequest.deleteMany({
    where: { contactEmail: `${TAG}@ecole.test` },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nTOUT EST CONFORME" : `\n${failures} ÉCHEC(S)`);
    process.exitCode = failures === 0 ? 0 : 1;
  })
  .catch((e) => {
    console.error("ERREUR", e);
    process.exitCode = 1;
  })
  .finally(cleanup);
