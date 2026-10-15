import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createTeacher } from "@/lib/services/teachers";
import { createSubject, setClassroomSubject } from "@/lib/services/subjects";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { createRoom } from "@/lib/services/rooms";
import {
  createSchedule,
  ensureSessionFromSchedule,
} from "@/lib/services/schedules";
import {
  saveSessionAttendance,
  addAttendanceRecord,
} from "@/lib/services/attendance";
import { upsertPolicy } from "@/lib/services/grading/policy";
import {
  ensureDefaultAssessmentTypes,
  createAssessment,
} from "@/lib/services/grading/assessments";
import { saveGrades } from "@/lib/services/grading/grades";
import {
  computeAndStore,
  setValidationStatus,
} from "@/lib/services/grading/results";
import {
  generateClassReportCards,
  updateResultAnnotations,
  ensureDefaultTemplates,
} from "@/lib/services/grading/reportcards";
import {
  ensureDefaultFeeCategories,
  createFeeTariff,
} from "@/lib/services/finance/fees";
import { generateCharges } from "@/lib/services/finance/accounts";
import { recordPayment, closeCashDay } from "@/lib/services/finance/payments";
import { createAnnouncement } from "@/lib/services/announcements";
import { notifyUsers } from "@/lib/services/notifications";
import { assignSubscription } from "@/lib/services/platform/subscriptions";

/**
 * Seed de DÉMONSTRATION — strictement réservé à l'environnement local.
 *
 * Verrous :
 *  - ALLOW_DEMO_SEED=1 obligatoire ;
 *  - DATABASE_URL doit pointer sur localhost et une base explicitement
 *    autorisée (DEMO_SEED_ALLOWED_DBS, défaut : ecomschool_dev,ecomschool_demo,ecomschool_test).
 *  - Refuse toute cible distante ou non listée.
 *
 * Propriétés :
 *  - Idempotent : find-or-create par clés naturelles (matricule, email, nom).
 *  - Jamais destructif : aucun delete, aucune réinitialisation de mot de passe.
 *  - Comptes existants réutilisés tels quels ; seuls les comptes manquants
 *    sont créés (mot de passe via SEED_DEMO_PASSWORD, jamais codé en dur).
 *  - Produit un bilan créé/réutilisé/ignoré.
 */

const report = {
  created: [] as string[],
  reused: [] as string[],
  skipped: [] as string[],
};
const mark = (k: keyof typeof report, label: string) => {
  report[k].push(label);
};

function assertDemoEnvironment() {
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error(
      "Refusé : ALLOW_DEMO_SEED=1 requis (seed de démonstration uniquement).",
    );
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL manquante.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL illisible.");
  }
  const host = url.hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      `Refusé : hôte distant '${host}' — le seed démo n'est autorisé qu'en local.`,
    );
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const allowed = (process.env.DEMO_SEED_ALLOWED_DBS ??
    "ecomschool_dev,ecomschool_demo,ecomschool_test")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(dbName)) {
    throw new Error(
      `Refusé : base '${dbName}' non autorisée (attendu : ${allowed.join(", ")}).`,
    );
  }
  return dbName;
}

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD;

/** Comptes démo gérés par ce script (réutilisés s'ils existent). */
const DEMO_ACCOUNT_EMAILS = [
  "admin@demo.local",
  "enseignant@demo.local",
  "parent@demo.local",
  "eleve@demo.local",
  "finance@demo.local",
  "caissier@demo.local",
  "commercial@ecom-school.local",
];

/**
 * Préflight : si des comptes démo doivent être créés, SEED_DEMO_PASSWORD
 * est exigé AVANT toute écriture (échec net au lieu d'un seed partiel).
 * Les comptes existants sont réutilisés tels quels — jamais de reset.
 */
async function assertPasswordReady() {
  const existing = await prisma.user.findMany({
    where: { email: { in: DEMO_ACCOUNT_EMAILS } },
    select: { email: true },
  });
  const missing = DEMO_ACCOUNT_EMAILS.filter(
    (e) => !existing.some((u) => u.email === e),
  );
  if (missing.length === 0) {
    console.log("Les 7 comptes démo existent — mots de passe conservés.");
    return;
  }
  if (!DEMO_PASSWORD) {
    throw new Error(
      `SEED_DEMO_PASSWORD requis : ${missing.length} compte(s) à créer (${missing.join(", ")}).`,
    );
  }
  console.log(`${missing.length} compte(s) démo à créer : ${missing.join(", ")}`);
}

type Ctx = { userId: string; schoolId: string };

/** Utilisateur école : réutilise l'existant (jamais de reset), crée sinon. */
async function schoolUser(
  schoolId: string,
  email: string,
  roleName: string,
  firstName: string,
  lastName: string,
) {
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    mark("reused", `user ${email}`);
    await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId, userId: existing.id } },
      update: {},
      create: { schoolId, userId: existing.id, roleId: role.id, status: "ACTIVE" },
    });
    return existing.id;
  }
  if (!DEMO_PASSWORD) {
    throw new Error(
      `SEED_DEMO_PASSWORD requis pour créer ${email} (aucun mot de passe codé en dur).`,
    );
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      schoolId,
      status: "ACTIVE",
      firstName,
      lastName,
    },
    select: { id: true },
  });
  await prisma.schoolMembership.create({
    data: { schoolId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  mark("created", `user ${email} (${roleName})`);
  return user.id;
}

/** Compte plateforme (ECOM-TOUCH) : User sans schoolId + UserRole. */
async function platformUser(email: string, roleName: string, firstName: string, lastName: string) {
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "PLATFORM", schoolId: null },
    select: { id: true },
  });
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    mark("reused", `user ${email}`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: role.id } },
      update: {},
      create: { userId: existing.id, roleId: role.id },
    });
    return existing.id;
  }
  if (!DEMO_PASSWORD) {
    throw new Error(`SEED_DEMO_PASSWORD requis pour créer ${email}.`);
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      status: "ACTIVE",
      firstName,
      lastName,
    },
    select: { id: true },
  });
  await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id },
  });
  mark("created", `user ${email} (${roleName})`);
  return user.id;
}

async function main() {
  const dbName = assertDemoEnvironment();
  console.log(`Seed démo autorisé sur '${dbName}' — données fictives uniquement.`);
  await assertPasswordReady();

  // ---------- École ----------
  const school = await prisma.school.upsert({
    where: { code: "DEMO-ECOLE" },
    update: {},
    create: {
      code: "DEMO-ECOLE",
      slug: "demo-ecole",
      name: "Collège Démo ECOM (données fictives)",
      city: "Ouagadougou",
      address: "Secteur 15 — adresse fictive",
      phone: "+226 00 00 00 00",
      email: "contact@demo.local",
      status: "ACTIVE",
    },
    select: { id: true, createdAt: true },
  });
  const schoolId = school.id;

  // ---------- Comptes ----------
  const adminId = await schoolUser(schoolId, "admin@demo.local", "ADMIN_SCHOOL", "Admin", "Démo");
  const teacherUserId = await schoolUser(schoolId, "enseignant@demo.local", "TEACHER", "Awa", "Kaboré");
  const parentUserId = await schoolUser(schoolId, "parent@demo.local", "PARENT", "Moussa", "Ouédraogo");
  const studentUserId = await schoolUser(schoolId, "eleve@demo.local", "STUDENT", "Aminata", "Ouédraogo");
  const financeUserId = await schoolUser(schoolId, "finance@demo.local", "FINANCE_MANAGER", "Issaka", "Traoré");
  await schoolUser(schoolId, "caissier@demo.local", "CASHIER", "Rasmata", "Sawadogo");
  const salesUserId = await platformUser("commercial@ecom-school.local", "PLATFORM_SALES", "Commercial", "ECOM-TOUCH");
  void salesUserId;

  const ctx: Ctx = { userId: adminId, schoolId };

  // ---------- Abonnement réel (PREMIUM : tous modules) ----------
  const activeSub = await prisma.schoolSubscription.findFirst({
    where: { schoolId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    select: { id: true, status: true },
  });
  if (activeSub) {
    mark("reused", `abonnement ${activeSub.status}`);
  } else {
    const plan = await prisma.subscriptionPlan.findFirstOrThrow({
      where: { code: "PREMIUM", status: "ACTIVE" },
      select: { id: true },
    });
    const owner = await prisma.user.findFirstOrThrow({
      where: { userRoles: { some: { role: { name: "PLATFORM_OWNER" } } } },
      select: { id: true },
    });
    const sub = await assignSubscription(owner.id, {
      schoolId,
      planId: plan.id,
      cycle: "YEARLY",
      startTrial: false,
    });
    if (!sub.ok) throw new Error(`assignSubscription: ${sub.error}`);
    mark("created", "abonnement PREMIUM (annuel, actif)");
  }

  // ---------- Année + périodes ----------
  let yearId = (
    await prisma.academicYear.findFirst({
      where: { schoolId, name: "2025-2026" },
      select: { id: true },
    })
  )?.id;
  if (!yearId) {
    const y = await createYear(ctx, {
      name: "2025-2026",
      startDate: "2025-10-01",
      endDate: "2026-06-30",
      periodType: "TRIMESTER",
      isCurrent: true,
    });
    if (!y.ok) throw new Error(`createYear: ${y.error}`);
    yearId = y.result.id;
    mark("created", "année 2025-2026");
  } else {
    mark("reused", "année 2025-2026");
  }
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId, academicYearId: yearId },
    orderBy: { number: "asc" },
  });
  const t1 = periods.find((p) => p.number === 1)!;

  // ---------- Niveaux / classes ----------
  const levelDefs = [
    { name: "6e (démo)", order: 1 },
    { name: "5e (démo)", order: 2 },
    { name: "4e (démo)", order: 3 },
  ];
  const levelIds: Record<string, string> = {};
  for (const l of levelDefs) {
    const existing = await prisma.level.findFirst({
      where: { schoolId, name: l.name },
      select: { id: true },
    });
    if (existing) {
      levelIds[l.name] = existing.id;
      mark("reused", `niveau ${l.name}`);
    } else {
      const r = await createLevel(ctx, l);
      if (!r.ok) throw new Error(`createLevel ${l.name}: ${r.error}`);
      levelIds[l.name] = r.result.id;
      mark("created", `niveau ${l.name}`);
    }
  }

  const classDefs = [
    { name: "6e A (démo)", level: "6e (démo)" },
    { name: "6e B (démo)", level: "6e (démo)" },
    { name: "5e A (démo)", level: "5e (démo)" },
    { name: "4e A (démo)", level: "4e (démo)" },
  ];
  const classIds: Record<string, string> = {};
  for (const c of classDefs) {
    const existing = await prisma.classroom.findFirst({
      where: { schoolId, name: c.name, academicYearId: yearId },
      select: { id: true },
    });
    if (existing) {
      classIds[c.name] = existing.id;
      mark("reused", `classe ${c.name}`);
    } else {
      const r = await createClassroom(ctx, {
        name: c.name,
        levelId: levelIds[c.level],
        academicYearId: yearId,
        capacity: 40,
      });
      if (!r.ok) throw new Error(`createClassroom ${c.name}: ${r.error}`);
      classIds[c.name] = r.result.id;
      mark("created", `classe ${c.name}`);
    }
  }

  // ---------- Enseignants ----------
  const teacherDefs = [
    { firstName: "Awa", lastName: "Kaboré (fictif)", email: "enseignant@demo.local" },
    { firstName: "Boukary", lastName: "Nikiéma (fictif)", email: "b.nikiema@demo.local" },
    { firstName: "Salimata", lastName: "Compaoré (fictif)", email: "s.compaore@demo.local" },
  ];
  const teacherIds: string[] = [];
  for (const t of teacherDefs) {
    let rec = await prisma.teacher.findFirst({
      where: { schoolId, email: t.email },
      select: { id: true, userId: true },
    });
    if (!rec) {
      const r = await createTeacher(ctx, t);
      if (!r.ok) throw new Error(`createTeacher ${t.email}: ${r.error}`);
      rec = { id: r.result.id, userId: null };
      mark("created", `enseignant ${t.firstName} ${t.lastName}`);
    } else {
      mark("reused", `enseignant ${t.email}`);
    }
    teacherIds.push(rec.id);
    if (t.email === "enseignant@demo.local" && !rec.userId) {
      await prisma.teacher.update({
        where: { id: rec.id },
        data: { userId: teacherUserId },
      });
    }
  }

  // ---------- Matières ----------
  const subjectDefs = [
    { name: "Mathématiques (démo)", code: "MTH", coef: 3, teacher: 0 },
    { name: "Français (démo)", code: "FRA", coef: 3, teacher: 0 },
    { name: "Histoire-Géographie (démo)", code: "HIS", coef: 2, teacher: 1 },
    { name: "SVT (démo)", code: "SVT", coef: 2, teacher: 1 },
    { name: "Anglais (démo)", code: "ANG", coef: 2, teacher: 2 },
    { name: "EPS (démo)", code: "EPS", coef: 1, teacher: 2 },
  ];
  const subjectIds: Record<string, string> = {};
  for (const s of subjectDefs) {
    const existing = await prisma.subject.findFirst({
      where: { schoolId, name: s.name },
      select: { id: true },
    });
    if (existing) {
      subjectIds[s.code] = existing.id;
      mark("reused", `matière ${s.name}`);
    } else {
      const r = await createSubject(ctx, { name: s.name, code: s.code });
      if (!r.ok) throw new Error(`createSubject ${s.code}: ${r.error}`);
      subjectIds[s.code] = r.result.id;
      mark("created", `matière ${s.name}`);
    }
  }
  for (const c of classDefs) {
    for (const s of subjectDefs) {
      await setClassroomSubject(ctx, {
        classroomId: classIds[c.name],
        subjectId: subjectIds[s.code],
        coefficient: s.coef,
        teacherId: teacherIds[s.teacher],
      });
      await prisma.teachingAssignment.upsert({
        where: {
          teacherId_classroomId_subjectId_academicYearId: {
            teacherId: teacherIds[s.teacher],
            classroomId: classIds[c.name],
            subjectId: subjectIds[s.code],
            academicYearId: yearId,
          },
        },
        update: {},
        create: {
          schoolId,
          teacherId: teacherIds[s.teacher],
          classroomId: classIds[c.name],
          subjectId: subjectIds[s.code],
          academicYearId: yearId,
        },
      });
    }
  }
  mark("reused", "affectations matières/enseignants (upsert)");

  // ---------- Politique de notation ----------
  await upsertPolicy(ctx, {
    academicYearId: yearId,
    maxScore: 20,
    passMark: 10,
    precision: 2,
    rounding: "HALF_UP",
    missingGradePolicy: "EXCLUDE",
    absentPolicy: "EXCLUDE",
    tieRule: "SHARED_RANK",
  });
  await ensureDefaultTemplates(ctx);
  for (const l of levelDefs) {
    await prisma.reportCardTemplate.updateMany({
      where: { schoolId, key: "college" },
      data: { levelId: levelIds[l.name] },
    });
  }

  // ---------- Salles ----------
  for (const r of [
    { code: "S-01", name: "Salle 1 (démo)", capacity: 45 },
    { code: "LAB-01", name: "Laboratoire (démo)", capacity: 24 },
  ]) {
    const existing = await prisma.room.findFirst({
      where: { schoolId, code: r.code },
      select: { id: true },
    });
    if (existing) {
      mark("reused", `salle ${r.code}`);
    } else {
      await createRoom(ctx, r);
      mark("created", `salle ${r.code}`);
    }
  }
  const roomId = (
    await prisma.room.findFirstOrThrow({
      where: { schoolId, code: "S-01" },
      select: { id: true },
    })
  ).id;

  // ---------- Élèves (~20) + inscriptions ----------
  const studentDefs: {
    matricule: string;
    firstName: string;
    lastName: string;
    sex: "FEMALE" | "MALE";
    classroom: string;
  }[] = [
    { matricule: "DEMO-001", firstName: "Aminata", lastName: "Ouédraogo", sex: "FEMALE", classroom: "6e A (démo)" },
    { matricule: "DEMO-002", firstName: "Ibrahim", lastName: "Sawadogo", sex: "MALE", classroom: "6e A (démo)" },
    { matricule: "DEMO-003", firstName: "Fatoumata", lastName: "Zongo", sex: "FEMALE", classroom: "6e A (démo)" },
    { matricule: "DEMO-004", firstName: "Boukari", lastName: "Diallo", sex: "MALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-005", firstName: "Mariam", lastName: "Kiemdé", sex: "FEMALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-006", firstName: "Souleymane", lastName: "Barro", sex: "MALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-007", firstName: "Aïcha", lastName: "Bouda", sex: "FEMALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-008", firstName: "Yannick", lastName: "Palenfo", sex: "MALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-009", firstName: "Rokia", lastName: "Ilboudo", sex: "FEMALE", classroom: "6e B (démo)" },
    { matricule: "DEMO-010", firstName: "Abdoul", lastName: "Ganamé", sex: "MALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-011", firstName: "Nadièye", lastName: "Ouedraogo", sex: "FEMALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-012", firstName: "Ismaël", lastName: "Cissé", sex: "MALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-013", firstName: "Fanta", lastName: "Zerbo", sex: "FEMALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-014", firstName: "Modeste", lastName: "Nana", sex: "MALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-015", firstName: "Salamata", lastName: "Karama", sex: "FEMALE", classroom: "5e A (démo)" },
    { matricule: "DEMO-016", firstName: "Aziz", lastName: "Kinda", sex: "MALE", classroom: "4e A (démo)" },
    { matricule: "DEMO-017", firstName: "Bibata", lastName: "Nignan", sex: "FEMALE", classroom: "4e A (démo)" },
    { matricule: "DEMO-018", firstName: "Evariste", lastName: "Some", sex: "MALE", classroom: "4e A (démo)" },
    { matricule: "DEMO-019", firstName: "Habibata", lastName: "Yarga", sex: "FEMALE", classroom: "4e A (démo)" },
    { matricule: "DEMO-020", firstName: "Lassané", lastName: "Zoungrana", sex: "MALE", classroom: "4e A (démo)" },
  ];

  const studentIds: string[] = [];
  for (const s of studentDefs) {
    const existing = await prisma.student.findFirst({
      where: { schoolId, matricule: s.matricule },
      select: { id: true },
    });
    let studentId = existing?.id;
    if (!studentId) {
      const r = await createStudent(ctx, {
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        sex: s.sex,
      });
      if (!r.ok) throw new Error(`createStudent ${s.matricule}: ${r.error}`);
      studentId = r.result.id;
      mark("created", `élève ${s.matricule}`);
    } else {
      mark("reused", `élève ${s.matricule}`);
    }
    studentIds.push(studentId);
    const enrolled = await prisma.enrollment.findFirst({
      where: { schoolId, studentId, academicYearId: yearId, status: "ENROLLED" },
      select: { id: true },
    });
    if (!enrolled) {
      const en = await enrollStudent(ctx, {
        studentId,
        classroomId: classIds[s.classroom],
        academicYearId: yearId,
      });
      if (en.ok) {
        await prisma.enrollment.update({
          where: { id: en.result.id },
          data: { enrolledAt: new Date("2025-10-02T00:00:00.000Z") },
        });
        mark("created", `inscription ${s.matricule} → ${s.classroom}`);
      }
    }
  }

  // Compte élève ↔ DEMO-001
  await prisma.student.update({
    where: { id: studentIds[0] },
    data: { userId: studentUserId },
  });

  // ---------- Parents ----------
  const guardianDefs = [
    { id: "demo-guardian-1", firstName: "Moussa", lastName: "Ouédraogo (fictif)", email: "parent@demo.local", phone: "+226 70 00 00 00", children: ["DEMO-001", "DEMO-002"], relation: "FATHER" as const },
    { id: "demo-guardian-2", firstName: "Adama", lastName: "Zongo (fictif)", email: null, phone: "+226 70 00 00 01", children: ["DEMO-003"], relation: "FATHER" as const },
    { id: "demo-guardian-3", firstName: "Safiatou", lastName: "Diallo (fictive)", email: null, phone: "+226 70 00 00 02", children: ["DEMO-004", "DEMO-005"], relation: "MOTHER" as const },
    { id: "demo-guardian-4", firstName: "Hamidou", lastName: "Barro (fictif)", email: null, phone: "+226 70 00 00 03", children: ["DEMO-006", "DEMO-007"], relation: "FATHER" as const },
    { id: "demo-guardian-5", firstName: "Jeanne", lastName: "Palenfo (fictive)", email: null, phone: "+226 70 00 00 04", children: ["DEMO-008", "DEMO-009"], relation: "MOTHER" as const },
    { id: "demo-guardian-6", firstName: "Oumar", lastName: "Ganamé (fictif)", email: null, phone: "+226 70 00 00 05", children: ["DEMO-010", "DEMO-011", "DEMO-012"], relation: "FATHER" as const },
    { id: "demo-guardian-7", firstName: "Mariatou", lastName: "Zerbo (fictive)", email: null, phone: "+226 70 00 00 06", children: ["DEMO-013", "DEMO-014", "DEMO-015"], relation: "MOTHER" as const },
    { id: "demo-guardian-8", firstName: "Abdoulaye", lastName: "Kinda (fictif)", email: null, phone: "+226 70 00 00 07", children: ["DEMO-016", "DEMO-017"], relation: "FATHER" as const },
    { id: "demo-guardian-9", firstName: "Clarisse", lastName: "Some (fictive)", email: null, phone: "+226 70 00 00 08", children: ["DEMO-018", "DEMO-019", "DEMO-020"], relation: "MOTHER" as const },
  ];
  const studentByMatricule = new Map(
    studentDefs.map((s, i) => [s.matricule, studentIds[i]]),
  );
  for (const g of guardianDefs) {
    const guardian = await prisma.guardian.upsert({
      where: { id: g.id },
      update: {},
      create: {
        id: g.id,
        schoolId,
        firstName: g.firstName,
        lastName: g.lastName,
        email: g.email,
        phone: g.phone,
      },
      select: { id: true, createdAt: true },
    });
    for (const mat of g.children) {
      const sid = studentByMatricule.get(mat)!;
      await prisma.studentGuardian.upsert({
        where: {
          studentId_guardianId_relation: {
            studentId: sid,
            guardianId: guardian.id,
            relation: g.relation,
          },
        },
        update: {},
        create: { schoolId, studentId: sid, guardianId: guardian.id, relation: g.relation },
      });
    }
    mark("reused", `tuteur ${g.lastName}`);
  }
  const mainGuardian = await prisma.guardian.findUniqueOrThrow({
    where: { id: "demo-guardian-1" },
    select: { id: true },
  });
  await prisma.guardian.update({
    where: { id: mainGuardian.id },
    data: { userId: parentUserId },
  });

  // ---------- Emplois du temps (créneaux récurrents) ----------
  const scheduleDefs: {
    classroom: string;
    subject: string;
    teacherIdx: number;
    weekday: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";
    startMin: number;
    endMin: number;
  }[] = [
    { classroom: "6e A (démo)", subject: "MTH", teacherIdx: 0, weekday: "MONDAY", startMin: 480, endMin: 600 },
    { classroom: "6e A (démo)", subject: "FRA", teacherIdx: 0, weekday: "TUESDAY", startMin: 600, endMin: 720 },
    { classroom: "6e A (démo)", subject: "HIS", teacherIdx: 1, weekday: "WEDNESDAY", startMin: 480, endMin: 540 },
    { classroom: "6e A (démo)", subject: "ANG", teacherIdx: 2, weekday: "THURSDAY", startMin: 660, endMin: 780 },
    { classroom: "6e A (démo)", subject: "SVT", teacherIdx: 1, weekday: "FRIDAY", startMin: 480, endMin: 600 },
    { classroom: "6e B (démo)", subject: "MTH", teacherIdx: 0, weekday: "MONDAY", startMin: 600, endMin: 720 },
    { classroom: "5e A (démo)", subject: "MTH", teacherIdx: 0, weekday: "TUESDAY", startMin: 480, endMin: 600 },
    { classroom: "5e A (démo)", subject: "FRA", teacherIdx: 0, weekday: "WEDNESDAY", startMin: 660, endMin: 780 },
    { classroom: "4e A (démo)", subject: "HIS", teacherIdx: 1, weekday: "THURSDAY", startMin: 480, endMin: 600 },
    { classroom: "4e A (démo)", subject: "EPS", teacherIdx: 2, weekday: "FRIDAY", startMin: 660, endMin: 780 },
  ];
  const scheduleIds: string[] = [];
  for (const d of scheduleDefs) {
    const existing = await prisma.courseSchedule.findFirst({
      where: {
        schoolId,
        classroomId: classIds[d.classroom],
        subjectId: subjectIds[d.subject],
        weekday: d.weekday,
        startMin: d.startMin,
        academicYearId: yearId,
      },
      select: { id: true },
    });
    if (existing) {
      scheduleIds.push(existing.id);
      continue;
    }
    const r = await createSchedule(ctx, {
      academicYearId: yearId,
      classroomId: classIds[d.classroom],
      teacherId: teacherIds[d.teacherIdx],
      subjectId: subjectIds[d.subject],
      roomId,
      weekday: d.weekday,
      startMin: d.startMin,
      endMin: d.endMin,
      validFrom: "2025-10-01",
      validUntil: "2026-06-30",
    });
    if (r.ok) {
      scheduleIds.push(r.result.id);
      mark("created", `créneau ${d.classroom} ${d.subject} ${d.weekday}`);
    } else {
      mark("skipped", `créneau ${d.classroom} ${d.subject} (${r.error})`);
    }
  }

  // ---------- Séances + présences ----------
  const sessionDates: Record<string, string[]> = {
    MONDAY: ["2025-11-10", "2025-11-17"],
    TUESDAY: ["2025-11-11", "2025-11-18"],
    WEDNESDAY: ["2025-11-12"],
    THURSDAY: ["2025-11-13"],
    FRIDAY: ["2025-11-14"],
  };
  const sessionIds: string[] = [];
  for (const d of scheduleDefs) {
    for (const date of sessionDates[d.weekday] ?? []) {
      const sched = scheduleIds[scheduleDefs.indexOf(d)];
      const s = await ensureSessionFromSchedule(ctx, sched, date);
      if (s.ok) sessionIds.push(s.result.id);
    }
  }
  mark("created", `${sessionIds.length} séances assurées`);

  // Appel sur 2 séances de 6e A : tout le monde présent sauf 1 absence + 1 retard
  const sixAEnrolled = await prisma.enrollment.findMany({
    where: { schoolId, classroomId: classIds["6e A (démo)"], status: "ENROLLED" },
    select: { studentId: true },
  });
  const sixASessions = await prisma.courseSession.findMany({
    where: { schoolId, classroomId: classIds["6e A (démo)"] },
    orderBy: { date: "asc" },
    take: 2,
    select: { id: true, startMin: true },
  });
  for (const sess of sixASessions) {
    await saveSessionAttendance(
      ctx,
      sess.id,
      sixAEnrolled.map((e, i) =>
        i === 1
          ? { studentId: e.studentId, status: "ABSENT" as const, reason: "Maladie (fictif)" }
          : i === 2
            ? {
                studentId: e.studentId,
                status: "LATE" as const,
                expectedMin: sess.startMin,
                arrivalMin: sess.startMin + 15,
              }
            : { studentId: e.studentId, status: "PRESENT" as const },
      ),
    );
  }
  // 2 absences manuelles
  for (const mat of ["DEMO-010", "DEMO-016"]) {
    await addAttendanceRecord(ctx, {
      studentId: studentByMatricule.get(mat)!,
      date: "2025-11-19",
      status: "ABSENT",
      reason: "Absence non justifiée (fictif)",
    });
  }
  mark("created", "appels de séances + 2 absences manuelles");

  // ---------- Évaluations + notes T1 (toutes les classes) ----------
  const types = await ensureDefaultAssessmentTypes(ctx);
  const devoir = types.find((t) => t.code === "DEVOIR")!;
  const compo = types.find((t) => t.code === "COMPOSITION")!;

  const classSubjects = await prisma.classroomSubject.findMany({
    where: { schoolId, classroomId: { in: Object.values(classIds) } },
    select: { classroomId: true, subjectId: true, teacherId: true },
  });
  let assessmentsCreated = 0;
  for (const cs of classSubjects) {
    const enrolled = await prisma.enrollment.findMany({
      where: {
        schoolId,
        classroomId: cs.classroomId,
        status: "ENROLLED",
        academicYearId: yearId,
      },
      select: { studentId: true },
    });
    if (enrolled.length === 0 || !cs.teacherId) continue;
    for (const [ti, type] of [devoir, compo].entries()) {
      const title = `${type.code === "DEVOIR" ? "Devoir" : "Composition"} démo`;
      let assess = await prisma.assessment.findFirst({
        where: {
          schoolId,
          classroomId: cs.classroomId,
          subjectId: cs.subjectId,
          academicPeriodId: t1.id,
          title,
        },
        select: { id: true },
      });
      if (!assess) {
        const a = await createAssessment(ctx, {
          academicYearId: yearId,
          academicPeriodId: t1.id,
          classroomId: cs.classroomId,
          subjectId: cs.subjectId,
          teacherId: cs.teacherId,
          typeId: type.id,
          title,
          date: new Date(ti === 0 ? "2025-11-15T00:00:00.000Z" : "2025-12-10T00:00:00.000Z"),
          maxScore: 20,
          coefficient: ti === 0 ? 1 : 2,
        });
        if (!a.ok) continue;
        assess = { id: a.result.id };
        assessmentsCreated++;
      }
      // Notes déterministes (8→18) pour tout l'effectif
      const marks = enrolled.map((e, i) => ({
        studentId: e.studentId,
        value: 8 + ((i * 7 + (ti === 0 ? 3 : 5)) % 11),
        status: "ENTERED" as const,
      }));
      await saveGrades(ctx, assess.id, marks);
      await prisma.assessment.update({
        where: { id: assess.id },
        data: { status: "PUBLISHED" },
      });
    }
  }
  mark("created", `${assessmentsCreated} évaluations nouvelles + notes`);

  // ---------- Résultats + bulletins T1 pour les classes non publiées ----------
  for (const c of classDefs) {
    const classroomId = classIds[c.name];
    const validation = await prisma.resultValidation.findFirst({
      where: { schoolId, classroomId, academicPeriodId: t1.id },
      select: { status: true },
    });
    if (validation?.status === "PUBLISHED") {
      mark("reused", `bulletins T1 ${c.name} (déjà publiés)`);
      continue;
    }
    await computeAndStore(ctx, { classroomId, academicPeriodId: t1.id });
    await generateClassReportCards(ctx, { classroomId, academicPeriodId: t1.id });
    await setValidationStatus(ctx, {
      classroomId,
      academicPeriodId: t1.id,
      status: "VALIDATED",
    });
    const enrolled = await prisma.enrollment.findMany({
      where: { schoolId, classroomId, status: "ENROLLED", academicYearId: yearId },
      select: { studentId: true },
    });
    for (const e of enrolled) {
      await updateResultAnnotations(ctx, {
        studentId: e.studentId,
        academicPeriodId: t1.id,
        generalAppreciation: "Trimestre fictif — travail correct.",
        councilDecision: "Encouragements",
        directionNote: "Poursuivre les efforts",
        sign: true,
      });
    }
    await generateClassReportCards(ctx, { classroomId, academicPeriodId: t1.id });
    await setValidationStatus(ctx, {
      classroomId,
      academicPeriodId: t1.id,
      status: "PUBLISHED",
    });
    mark("created", `bulletins T1 ${c.name} publiés`);
  }

  // ---------- Finance : catégories, tarifs, créances, paiements ----------
  const categories = await ensureDefaultFeeCategories(ctx);
  const catBy = (code: string) => categories.find((c) => c.code === code)!;
  const tariffCount = await prisma.feeTariff.count({
    where: { schoolId, academicYearId: yearId },
  });
  if (tariffCount === 0) {
    await createFeeTariff(ctx, {
      academicYearId: yearId,
      categoryId: catBy("INSCRIPTION").id,
      amount: 15000,
      paymentPlan: "SINGLE",
      installmentCount: 1,
      effectiveFrom: new Date("2025-09-15T00:00:00Z"),
    });
    await createFeeTariff(ctx, {
      academicYearId: yearId,
      categoryId: catBy("SCOLARITE").id,
      amount: 90000,
      paymentPlan: "INSTALLMENTS",
      installmentCount: 3,
      effectiveFrom: new Date("2025-09-15T00:00:00Z"),
    });
    await createFeeTariff(ctx, {
      academicYearId: yearId,
      categoryId: catBy("CANTINE").id,
      amount: 30000,
      paymentPlan: "INSTALLMENTS",
      installmentCount: 3,
      effectiveFrom: new Date("2025-09-15T00:00:00Z"),
    });
    mark("created", "3 tarifs (inscription, scolarité 3×, cantine 3×)");
  } else {
    mark("reused", `${tariffCount} tarifs existants`);
  }

  const gen = await generateCharges(ctx, { academicYearId: yearId });
  if (gen.ok) mark("created", `créances : ${gen.result.created} créées / ${gen.result.skipped} ignorées`);

  let payments = 0;
  for (const [i, sid] of studentIds.entries()) {
    const p1 = await recordPayment(ctx, {
      studentId: sid,
      academicYearId: yearId,
      amount: 30000,
      method: i % 3 === 0 ? "MOBILE_MONEY" : "CASH",
      observation: "Versement initial — données de démonstration",
      idempotencyKey: `demo-p1-${sid}-${yearId}`,
    });
    if (p1.ok) payments++;
    if (i < 8) {
      const p2 = await recordPayment(ctx, {
        studentId: sid,
        academicYearId: yearId,
        amount: 20000,
        method: "CASH",
        observation: "Deuxième versement — données de démonstration",
        idempotencyKey: `demo-p2-${sid}-${yearId}`,
      });
      if (p2.ok) payments++;
    }
  }
  mark("created", `${payments} paiements enregistrés`);

  // Repartir quelques paiements sur une date passée puis clôturer ce jour
  const cashDay = new Date("2025-11-28T00:00:00Z");
  const demoPayments = await prisma.payment.findMany({
    where: { schoolId, observation: { contains: "démonstration" } },
    orderBy: { createdAt: "asc" },
    take: 6,
    select: { id: true },
  });
  await prisma.payment.updateMany({
    where: { id: { in: demoPayments.map((p) => p.id) } },
    data: { paidAt: cashDay },
  });
  const closure = await closeCashDay(ctx, cashDay);
  mark(closure.ok ? "created" : "reused", "clôture de caisse 2025-11-28");

  // ---------- Communication ----------
  const announcements = [
    {
      title: "Réunion parents-professeurs (démo)",
      body: "Réunion fictive prévue samedi prochain à 9h dans la salle polyvalente.",
      audience: "PARENTS" as const,
    },
    {
      title: "Examens du trimestre 2 (démo)",
      body: "Le calendrier des compositions du deuxième trimestre sera communiqué prochainement.",
      audience: "ALL" as const,
    },
  ];
  for (const a of announcements) {
    const existing = await prisma.announcement.findFirst({
      where: { schoolId, title: a.title },
      select: { id: true },
    });
    if (existing) {
      mark("reused", `annonce « ${a.title} »`);
    } else {
      await createAnnouncement(ctx, { ...a, publish: true });
      mark("created", `annonce « ${a.title} »`);
    }
  }

  // ---------- Notifications ----------
  const notifTargets = [adminId, teacherUserId, parentUserId, financeUserId].filter(Boolean);
  const existingNotifs = await prisma.notification.count({
    where: { schoolId, title: "Bulletins du trimestre 1 publiés (démo)" },
  });
  if (existingNotifs === 0) {
    await notifyUsers({
      schoolId,
      userIds: notifTargets,
      type: "REPORT_CARD_PUBLISHED",
      title: "Bulletins du trimestre 1 publiés (démo)",
      body: "Les bulletins fictifs du premier trimestre sont disponibles.",
      link: "/app/report-cards",
    });
    mark("created", `notifications → ${notifTargets.length} comptes`);
  } else {
    mark("reused", "notifications démo");
  }

  // ---------- Bilan ----------
  const counts = {
    users: await prisma.user.count({ where: { schoolId } }),
    students: await prisma.student.count({ where: { schoolId } }),
    guardians: await prisma.guardian.count({ where: { schoolId } }),
    teachers: await prisma.teacher.count({ where: { schoolId } }),
    classrooms: await prisma.classroom.count({ where: { schoolId } }),
    enrollments: await prisma.enrollment.count({ where: { schoolId } }),
    assessments: await prisma.assessment.count({ where: { schoolId } }),
    grades: await prisma.grade.count({ where: { schoolId } }),
    reportCards: await prisma.reportCard.count({ where: { schoolId } }),
    schedules: await prisma.courseSchedule.count({ where: { schoolId } }),
    sessions: await prisma.courseSession.count({ where: { schoolId } }),
    attendance: await prisma.attendanceRecord.count({ where: { schoolId } }),
    charges: await prisma.studentFeeCharge.count({ where: { schoolId } }),
    payments: await prisma.payment.count({ where: { schoolId } }),
    closures: await prisma.cashClosure.count({ where: { schoolId } }),
    announcements: await prisma.announcement.count({ where: { schoolId } }),
    notifications: await prisma.notification.count({ where: { schoolId } }),
  };
  console.log("\n=== BILAN SEED DÉMO ===");
  console.log("Créés    :", report.created.length);
  console.log("Réutilisés :", report.reused.length);
  console.log("Ignorés  :", report.skipped.length);
  if (report.skipped.length) console.log("  →", report.skipped.join(" | "));
  console.log("\nTotaux DEMO-ECOLE :", JSON.stringify(counts, null, 1));
  console.log(
    "\nComptes démo : admin / enseignant / parent / eleve / finance / caissier @demo.local",
  );
  console.log("Plateforme   : commercial@ecom-school.local (PLATFORM_SALES)");
}

main()
  .catch((e) => {
    console.error("SEED_DEMO_FAILED:", e.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
