import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { Prisma, SubscriptionStatus } from "@prisma/client";

/**
 * Correspondance permission SCHOOL → module commercial.
 * Une permission non listée n'est pas restreinte par le catalogue.
 */
export const PERMISSION_MODULE: Record<string, string> = {
  // Administration scolaire
  "school.manage": "ADMINISTRATION",
  "user.read": "ADMINISTRATION",
  "user.manage": "ADMINISTRATION",
  "academic.manage": "ADMINISTRATION",
  // Élèves
  "students.read": "STUDENTS",
  "students.manage": "STUDENTS",
  "guardians.read": "STUDENTS",
  "guardians.manage": "STUDENTS",
  "student.create": "STUDENTS",
  "enrollment.create": "STUDENTS",
  "enrollments.read": "STUDENTS",
  "enrollments.manage": "STUDENTS",
  // Enseignants
  "teachers.read": "TEACHERS",
  "teachers.manage": "TEACHERS",
  // Classes & matières
  "classes.read": "CLASSES_SUBJECTS",
  "classes.manage": "CLASSES_SUBJECTS",
  "levels.read": "CLASSES_SUBJECTS",
  "levels.manage": "CLASSES_SUBJECTS",
  "subjects.read": "CLASSES_SUBJECTS",
  "subjects.manage": "CLASSES_SUBJECTS",
  "rooms.read": "CLASSES_SUBJECTS",
  "rooms.manage": "CLASSES_SUBJECTS",
  // EDT
  "schedules.read": "SCHEDULES",
  "schedules.manage": "SCHEDULES",
  "sessions.read": "SCHEDULES",
  "sessions.manage": "SCHEDULES",
  "courses.read": "SCHEDULES",
  "courses.manage": "SCHEDULES",
  "teacher.dashboard": "SCHEDULES",
  // Présences
  "attendance.read": "ATTENDANCE",
  "attendance.manage": "ATTENDANCE",
  // Notes
  "assessments.read": "GRADES",
  "assessments.create": "GRADES",
  "assessments.manage": "GRADES",
  "grades.read": "GRADES",
  "grades.enter": "GRADES",
  "grades.update": "GRADES",
  "grades.validate": "GRADES",
  "grades.calculate": "GRADES",
  // Bulletins & résultats
  "results.read": "REPORT_CARDS",
  "results.validate": "REPORT_CARDS",
  "results.publish": "REPORT_CARDS",
  "reportcards.read": "REPORT_CARDS",
  "reportcards.generate": "REPORT_CARDS",
  "reportcards.validate": "REPORT_CARDS",
  "reportcards.publish": "REPORT_CARDS",
  "reportcards.print": "REPORT_CARDS",
  "gradingpolicy.manage": "REPORT_CARDS",
  // Portails
  "portal.parent": "PARENT_PORTAL",
  "portal.student": "STUDENT_PORTAL",
  "portal.manage": "ADMINISTRATION",
  // Finances
  "finance.read": "FINANCE",
  "finance.configure": "FINANCE",
  "finance.fees.manage": "FINANCE",
  "finance.discounts.manage": "FINANCE",
  "finance.payments.create": "FINANCE",
  "finance.payments.validate": "FINANCE",
  "finance.payments.cancel": "FINANCE",
  "finance.receipts.read": "FINANCE",
  "finance.receipts.print": "FINANCE",
  "finance.reports.read": "FINANCE",
  "finance.cash.close": "FINANCE",
  // Communication
  "announcements.read": "COMMUNICATION",
  "announcements.manage": "COMMUNICATION",
  "notifications.read": "COMMUNICATION",
  "messages.read": "COMMUNICATION",
  "messages.manage": "COMMUNICATION",
  "preferences.read": "COMMUNICATION",
};

/**
 * Matrice V2 (lot A2) : clés de permission corrigées et caisse éclatée.
 * Inactive tant que SUBSCRIPTION_MATRIX_V2 n'est pas défini — l'activation
 * doit être coordonnée avec la mise à jour de PlanModule (voir
 * docs/a2-preparation-technique-abonnements.md).
 */
export const PERMISSION_MODULE_V2: Record<string, string> = {
  // Administration scolaire
  "school.read": "ADMINISTRATION",
  "school.manage": "ADMINISTRATION",
  "user.read": "ADMINISTRATION",
  "user.manage": "ADMINISTRATION",
  "academic.read": "ADMINISTRATION",
  "academic.manage": "ADMINISTRATION",
  "portal.manage": "ADMINISTRATION",
  "notifications.read": "ADMINISTRATION",
  "preferences.read": "ADMINISTRATION",
  // Élèves, tuteurs, inscriptions
  "student.read": "STUDENTS",
  "student.manage": "STUDENTS",
  "students.read": "STUDENTS",
  "students.manage": "STUDENTS",
  "guardian.read": "STUDENTS",
  "guardian.manage": "STUDENTS",
  "guardians.read": "STUDENTS",
  "guardians.manage": "STUDENTS",
  "student.create": "STUDENTS",
  "enrollment.read": "STUDENTS",
  "enrollment.create": "STUDENTS",
  "enrollment.manage": "STUDENTS",
  "enrollments.read": "STUDENTS",
  "enrollments.manage": "STUDENTS",
  // Enseignants
  "teacher.read": "TEACHERS",
  "teacher.manage": "TEACHERS",
  "teachers.read": "TEACHERS",
  "teachers.manage": "TEACHERS",
  // Classes & matières
  "classroom.read": "CLASSES_SUBJECTS",
  "classroom.manage": "CLASSES_SUBJECTS",
  "classes.read": "CLASSES_SUBJECTS",
  "classes.manage": "CLASSES_SUBJECTS",
  "levels.read": "CLASSES_SUBJECTS",
  "levels.manage": "CLASSES_SUBJECTS",
  "subject.read": "CLASSES_SUBJECTS",
  "subject.manage": "CLASSES_SUBJECTS",
  "subjects.read": "CLASSES_SUBJECTS",
  "subjects.manage": "CLASSES_SUBJECTS",
  "rooms.read": "CLASSES_SUBJECTS",
  "rooms.manage": "CLASSES_SUBJECTS",
  // EDT
  "schedules.read": "SCHEDULES",
  "schedules.manage": "SCHEDULES",
  "schedules.print": "SCHEDULES",
  "sessions.read": "SCHEDULES",
  "sessions.manage": "SCHEDULES",
  "courses.read": "SCHEDULES",
  "courses.manage": "SCHEDULES",
  "coursecontent.manage": "SCHEDULES",
  "teacher.dashboard": "SCHEDULES",
  // Présences
  "attendance.read": "ATTENDANCE",
  "attendance.manage": "ATTENDANCE",
  "attendance.justify": "ATTENDANCE",
  // Notes
  "assessments.read": "GRADES",
  "assessments.create": "GRADES",
  "assessments.manage": "GRADES",
  "grade.read": "GRADES",
  "grade.manage": "GRADES",
  "grades.read": "GRADES",
  "grades.enter": "GRADES",
  "grades.update": "GRADES",
  "grades.validate": "GRADES",
  "grades.calculate": "GRADES",
  // Bulletins & résultats
  "results.read": "REPORT_CARDS",
  "results.validate": "REPORT_CARDS",
  "results.publish": "REPORT_CARDS",
  "reportcards.read": "REPORT_CARDS",
  "reportcards.generate": "REPORT_CARDS",
  "reportcards.validate": "REPORT_CARDS",
  "reportcards.publish": "REPORT_CARDS",
  "reportcards.print": "REPORT_CARDS",
  "gradingpolicy.manage": "REPORT_CARDS",
  // Portails
  "portal.parent": "PARENT_PORTAL",
  "portal.student": "STUDENT_PORTAL",
  // Caisse — socle (consultation, encaissements, reçus, impayés)
  "finance.read": "FINANCE_CORE",
  "finance.payments.create": "FINANCE_CORE",
  "finance.payments.read": "FINANCE_CORE",
  "finance.receipts.read": "FINANCE_CORE",
  "finance.receipts.print": "FINANCE_CORE",
  "finance.reports.read": "FINANCE_CORE",
  // Finance — supervision (config, remises, validation, clôture)
  "finance.configure": "FINANCE_MGMT",
  "finance.fees.manage": "FINANCE_MGMT",
  "finance.discounts.manage": "FINANCE_MGMT",
  "finance.payments.validate": "FINANCE_MGMT",
  "finance.payments.cancel": "FINANCE_MGMT",
  "finance.cash.close": "FINANCE_MGMT",
  "finance.manage": "FINANCE_MGMT",
  // Communication
  "announcements.read": "COMMUNICATION",
  "announcements.manage": "COMMUNICATION",
  "messages.read": "COMMUNICATION",
  "messages.manage": "COMMUNICATION",
  // Rapports détaillés
  "reports.attendance": "REPORTS",
};

/**
 * Bascule contrôlée vers la matrice V2. Restée inactive par défaut :
 * l'activation exige un redémarrage applicatif et la mise à jour
 * coordonnée de PlanModule (FINANCE_CORE / FINANCE_MGMT).
 */
export function subscriptionMatrixV2Enabled() {
  return process.env.SUBSCRIPTION_MATRIX_V2 === "1";
}

function permissionModuleMap() {
  return subscriptionMatrixV2Enabled() ? PERMISSION_MODULE_V2 : PERMISSION_MODULE;
}

/** Permissions toujours accordées même en suspension (lecture/restitution). */
const ALWAYS_ALLOWED_IN_SUSPENSION = new Set([
  "portal.parent",
  "portal.student",
]);

function isReadPermission(key: string) {
  return key.endsWith(".read") || key.endsWith(".print") || ALWAYS_ALLOWED_IN_SUSPENSION.has(key);
}

// ---------- Abonnement courant ----------

/** Dernier abonnement de l'école (le plus récent), quel que soit le statut. */
export async function getCurrentSubscription(schoolId: string) {
  return prisma.schoolSubscription.findFirst({
    where: { schoolId },
    orderBy: { createdAt: "desc" },
    include: {
      plan: { include: { modules: { include: { module: true } } } },
    },
  });
}

/**
 * Modules accessibles = modules du plan actif ± overrides.
 * Sans abonnement (écoles historiques) : tout est autorisé.
 * SUSPENDED/CANCELLED/EXPIRED : aucun module « gestion » n'est actif.
 */
export async function getEntitlements(schoolId: string) {
  const sub = await getCurrentSubscription(schoolId);
  const overrides = await prisma.schoolModuleOverride.findMany({
    where: { schoolId },
    select: { module: { select: { code: true } }, enabled: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.module.code, o.enabled]));

  if (!sub) {
    return {
      subscription: null,
      status: null as SubscriptionStatus | null,
      planModules: null as Set<string> | null,
      overrides: overrideMap,
      isModuleEnabled: (code: string) => overrideMap.get(code) ?? true,
    };
  }

  const planModules = new Set(sub.plan.modules.map((m) => m.module.code));
  // Dépendances : ajouter les prérequis des modules du plan
  const catalog = await prisma.platformModule.findMany({
    select: { code: true, dependsOn: true },
  });
  for (const m of catalog) {
    if (planModules.has(m.code)) {
      for (const dep of m.dependsOn) planModules.add(dep);
    }
  }

  const active = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(sub.status);
  return {
    subscription: sub,
    status: sub.status,
    planModules,
    overrides: overrideMap,
    isModuleEnabled: (code: string) => {
      const o = overrideMap.get(code);
      if (o !== undefined) return o && active;
      return active && planModules.has(code);
    },
  };
}

/** Vérifie qu'un module est activé pour l'école (droits d'abonnement réels). */
export async function isModuleEnabled(schoolId: string, moduleCode: string) {
  const ent = await getEntitlements(schoolId);
  return ent.isModuleEnabled(moduleCode);
}

/**
 * Version pure de la couverture abonnement : prend des entitlements déjà
 * chargés (évite de re-requêter la base pour chaque permission, ex. menus).
 * - Permission non mappée → autorisée.
 * - Pas d'abonnement → autorisé (écoles historiques).
 * - Suspension/expiration → seules les lectures passent.
 */
export function permissionCoveredByEntitlements(
  ent: Awaited<ReturnType<typeof getEntitlements>>,
  permissionKey: string,
) {
  if (!ent.subscription) return true;

  const moduleCode = permissionModuleMap()[permissionKey];
  const active = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(
    ent.status as SubscriptionStatus,
  );

  if (!active) {
    // Suspension / expiration / résiliation : lecture seule.
    return isReadPermission(permissionKey);
  }
  if (!moduleCode) return true;
  return ent.isModuleEnabled(moduleCode);
}

/**
 * Vérifie que la permission est couverte par l'abonnement.
 */
export async function isPermissionCoveredBySubscription(
  schoolId: string,
  permissionKey: string,
) {
  const ent = await getEntitlements(schoolId);
  return permissionCoveredByEntitlements(ent, permissionKey);
}

// ---------- Limites commerciales ----------

export type LimitKind = "students" | "users";

export async function getLimits(schoolId: string) {
  const sub = await getCurrentSubscription(schoolId);
  if (!sub) return { maxStudents: null, maxUsers: null, subscription: null };
  const active = !["CANCELLED", "EXPIRED"].includes(sub.status);
  return {
    maxStudents: active ? sub.plan.maxStudents : null,
    maxUsers: active ? sub.plan.maxUsers : null,
    subscription: sub,
  };
}

/** Retourne true si l'ajout d'une unité reste dans la limite. */
export async function checkLimit(
  schoolId: string,
  kind: LimitKind,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const { maxStudents, maxUsers } = await getLimits(schoolId);
  if (kind === "students") {
    if (maxStudents == null) return { ok: true as const };
    const count = await db.enrollment.count({
      where: { schoolId, status: "ENROLLED" },
    });
    return count < maxStudents
      ? { ok: true as const }
      : { ok: false as const, error: "LIMIT_STUDENTS" as const, count, max: maxStudents };
  }
  if (maxUsers == null) return { ok: true as const };
  const count = await db.schoolMembership.count({
    where: { schoolId, status: "ACTIVE" },
  });
  return count < maxUsers
    ? { ok: true as const }
    : { ok: false as const, error: "LIMIT_USERS" as const, count, max: maxUsers };
}

export async function usageSnapshot(schoolId: string) {
  const [students, users] = await Promise.all([
    prisma.enrollment.count({ where: { schoolId, status: "ENROLLED" } }),
    prisma.schoolMembership.count({ where: { schoolId, status: "ACTIVE" } }),
  ]);
  const { maxStudents, maxUsers } = await getLimits(schoolId);
  return { students, users, maxStudents, maxUsers };
}

// ---------- Admin : catalogue et overrides ----------

export async function listModules() {
  return prisma.platformModule.findMany({ orderBy: { name: "asc" } });
}

export async function setModuleOverride(
  actorUserId: string,
  input: { schoolId: string; moduleCode: string; enabled: boolean; note?: string },
) {
  const mod = await prisma.platformModule.findUnique({
    where: { code: input.moduleCode },
    select: { id: true },
  });
  if (!mod) return { ok: false as const, error: "NOT_FOUND" as const };
  await prisma.schoolModuleOverride.upsert({
    where: {
      schoolId_moduleId: { schoolId: input.schoolId, moduleId: mod.id },
    },
    update: { enabled: input.enabled, note: input.note ?? null, createdById: actorUserId },
    create: {
      schoolId: input.schoolId,
      moduleId: mod.id,
      enabled: input.enabled,
      note: input.note ?? null,
      createdById: actorUserId,
    },
  });
  await logAudit({
    actorId: actorUserId,
    schoolId: input.schoolId,
    action: "platform.module.override",
    entity: "PlatformModule",
    entityId: mod.id,
    metadata: { code: input.moduleCode, enabled: input.enabled },
  });
  return { ok: true as const };
}
