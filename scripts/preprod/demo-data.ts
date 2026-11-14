import "../lib/recette-guard";
/**
 * Jeu de données de démonstration — ÉCOLE DÉMO VALIDATION (preprod).
 * Données 100 % fictives mais réalistes (contexte ouest-africain), pour la
 * recette utilisateur et les démonstrations commerciales.
 *
 * Idempotent : chaque entité est retrouvée par une clé naturelle avant
 * création — relancer le script ne crée aucun doublon.
 *
 * Exécution (tunnel DB ouvert) :
 *   ALLOW_RECETTE=1 DATABASE_URL=... npx tsx scripts/preprod/demo-data.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { enrollStudent } from "@/lib/services/enrollments";
import { recordPayment } from "@/lib/services/finance/payments";
import { createEmployee, createContract } from "@/lib/services/hr/employees";
import { upsertLeaveRule, provisionLeaveBalances, requestLeave } from "@/lib/services/hr/leaves";
import { ensureDefaultExpenseCategories, createExpense, payExpense } from "@/lib/services/finance/expenses";
import { createAnnouncement } from "@/lib/services/announcements";

const SLUG = "demo-validation";
let pass = 0, created = 0;
const note = (label: string, isNew: boolean) => {
  pass++;
  if (isNew) created++;
  console.log(`  ${isNew ? "＋" : "="} ${label}`);
};

async function ctxOf(role: string, schoolId: string) {
  const m = await prisma.schoolMembership.findFirstOrThrow({
    where: { schoolId, role: { name: role } }, select: { userId: true },
  });
  return { userId: m.userId, schoolId };
}

const STUDENTS: { mat: string; first: string; last: string; sex: "MALE" | "FEMALE"; birth: string }[] = [
  { mat: "D-E001", first: "Awa", last: "Ouédraogo", sex: "FEMALE", birth: "2014-03-12" },
  { mat: "D-E002", first: "Ibrahim", last: "Sawadogo", sex: "MALE", birth: "2014-07-02" },
  { mat: "D-E003", first: "Mariam", last: "Compaoré", sex: "FEMALE", birth: "2013-11-25" },
  { mat: "D-E004", first: "Souleymane", last: "Kaboré", sex: "MALE", birth: "2013-05-18" },
  { mat: "D-E005", first: "Fatoumata", last: "Zongo", sex: "FEMALE", birth: "2012-09-30" },
  { mat: "D-E006", first: "Yacouba", last: "Traoré", sex: "MALE", birth: "2012-01-14" },
  { mat: "D-E007", first: "Salimata", last: "Nikiéma", sex: "FEMALE", birth: "2014-06-08" },
  { mat: "D-E008", first: "Moussa", last: "Sanon", sex: "MALE", birth: "2013-02-27" },
  { mat: "D-E009", first: "Rokia", last: "Ilboudo", sex: "FEMALE", birth: "2012-10-05" },
  { mat: "D-E010", first: "Adama", last: "Tiendrébéogo", sex: "MALE", birth: "2014-04-19" },
  { mat: "D-E011", first: "Bibata", last: "Pale", sex: "FEMALE", birth: "2013-08-22" },
  { mat: "D-E012", first: "Issouf", last: "Bamogo", sex: "MALE", birth: "2012-12-11" },
];

const EMPLOYEES: { mat: string; first: string; last: string; cat: "TEACHING" | "NON_TEACHING"; pos: string; salary: number }[] = [
  { mat: "D-P001", first: "Harmonie", last: "Kientega", cat: "TEACHING", pos: "Enseignante de mathématiques", salary: 145000 },
  { mat: "D-P002", first: "Prosper", last: "Some", cat: "TEACHING", pos: "Enseignant de français", salary: 138000 },
  { mat: "D-P003", first: "Nadège", last: "Yaméogo", cat: "TEACHING", pos: "Enseignante de SVT", salary: 132000 },
  { mat: "D-P004", first: "Boukary", last: "Ouattara", cat: "NON_TEACHING", pos: "Secrétaire de direction", salary: 95000 },
  { mat: "D-P005", first: "Clarisse", last: "Nana", cat: "NON_TEACHING", pos: "Comptable", salary: 120000 },
];

async function main() {
  const school = await prisma.school.findUniqueOrThrow({ where: { slug: SLUG } });
  const sid = school.id;
  const admin = await ctxOf("DEMO_ADMIN", sid);
  const compta = await ctxOf("COMPTABLE_DEMO", sid);
  const rh = await ctxOf("RH_DEMO", sid);
  const paie = await ctxOf("PAIE_DEMO", sid);
  const now = new Date();
  console.log(`École : ${school.name}`);

  // ---------- Année scolaire ----------
  const year = (await prisma.academicYear.findFirst({ where: { schoolId: sid, isCurrent: true } }))
    ?? await prisma.academicYear.create({
      data: { schoolId: sid, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), isCurrent: true },
    });
  note(`année scolaire ${year.name}`, false);

  // ---------- Niveaux & classes ----------
  const LEVELS = ["Sixième", "Cinquième", "Quatrième", "Troisième"] as const;
  const CLASSES = [
    { name: "6e A", lvl: "Sixième" }, { name: "6e B", lvl: "Sixième" },
    { name: "5e A", lvl: "Cinquième" }, { name: "4e A", lvl: "Quatrième" }, { name: "3e A", lvl: "Troisième" },
  ] as const;
  const rooms: Record<string, { id: string; levelId: string }> = {};
  for (const c of CLASSES) {
    const lvl = (await prisma.level.findFirst({ where: { schoolId: sid, name: c.lvl } }))
      ?? await prisma.level.create({ data: { schoolId: sid, name: c.lvl } });
    const room = (await prisma.classroom.findFirst({ where: { schoolId: sid, name: c.name, academicYearId: year.id } }))
      ?? await prisma.classroom.create({ data: { schoolId: sid, academicYearId: year.id, levelId: lvl.id, name: c.name, capacity: 45 } });
    rooms[c.name] = { id: room.id, levelId: lvl.id };
    note(`classe ${c.name}`, (await prisma.enrollment.count({ where: { classroomId: room.id } })) === 0);
  }

  // ---------- Grille tarifaire ----------
  const CATS = [
    { code: "SCOL", label: "Scolarité annuelle" },
    { code: "INSC", label: "Frais d'inscription" },
    { code: "CANT", label: "Cantine (optionnel)" },
  ];
  const cats: Record<string, string> = {};
  for (const c of CATS) {
    const cat = (await prisma.feeCategory.findFirst({ where: { schoolId: sid, code: c.code } }))
      ?? await prisma.feeCategory.create({ data: { schoolId: sid, ...c } });
    cats[c.code] = cat.id;
  }
  const TARIFFS = [
    { cat: "SCOL", amount: 75000, lvl: "Sixième", mandatory: true },
    { cat: "SCOL", amount: 75000, lvl: "Cinquième", mandatory: true },
    { cat: "SCOL", amount: 85000, lvl: "Quatrième", mandatory: true },
    { cat: "SCOL", amount: 85000, lvl: "Troisième", mandatory: true },
    { cat: "INSC", amount: 15000, lvl: null, mandatory: true },
    { cat: "CANT", amount: 60000, lvl: null, mandatory: false },
  ];
  for (const t of TARIFFS) {
    const levelId = t.lvl ? (await prisma.level.findFirstOrThrow({ where: { schoolId: sid, name: t.lvl } })).id : null;
    const exists = await prisma.feeTariff.findFirst({
      where: { schoolId: sid, academicYearId: year.id, categoryId: cats[t.cat], levelId, classroomId: null },
    });
    if (!exists) {
      await prisma.feeTariff.create({
        data: { schoolId: sid, academicYearId: year.id, categoryId: cats[t.cat], levelId, amount: t.amount, mandatory: t.mandatory, status: "ACTIVE" },
      });
      note(`tarif ${t.cat} ${t.lvl ?? "global"} ${t.amount}`, true);
    } else note(`tarif ${t.cat} ${t.lvl ?? "global"}`, false);
  }

  // ---------- Élèves + inscriptions (→ créances auto via M10) ----------
  const roomCycle = ["6e A", "6e B", "5e A", "4e A", "3e A"];
  for (let i = 0; i < STUDENTS.length; i++) {
    const s = STUDENTS[i];
    let student = await prisma.student.findFirst({ where: { schoolId: sid, matricule: s.mat } });
    if (!student) {
      student = await prisma.student.create({
        data: {
          schoolId: sid, matricule: s.mat, firstName: s.first, lastName: s.last,
          sex: s.sex, birthDate: new Date(s.birth),
        },
      });
    }
    const room = rooms[roomCycle[i % roomCycle.length]];
    const enr = await prisma.enrollment.findFirst({
      where: { schoolId: sid, studentId: student.id, academicYearId: year.id },
    });
    if (!enr) {
      const r = await enrollStudent(admin, { studentId: student.id, classroomId: room.id, academicYearId: year.id });
      note(`inscription ${s.first} ${s.last} → ${roomCycle[i % roomCycle.length]}${r.ok ? "" : ` (${r.error})`}`, r.ok);
    } else note(`inscription ${s.first} ${s.last}`, false);
  }

  // ---------- Paiements partiels (parcours caisse) ----------
  const payments = [
    { mat: "D-E001", amount: 50000 }, { mat: "D-E002", amount: 90000 },
    { mat: "D-E003", amount: 40000 }, { mat: "D-E005", amount: 100000 },
    { mat: "D-E007", amount: 30000 }, { mat: "D-E010", amount: 85000 },
  ];
  for (const p of payments) {
    const st = await prisma.student.findFirstOrThrow({ where: { schoolId: sid, matricule: p.mat } });
    const already = await prisma.payment.findFirst({
      where: { schoolId: sid, studentId: st.id, amount: p.amount, status: "VALIDATED" },
    });
    if (already) { note(`paiement ${p.mat} ${p.amount} (existant)`, false); continue; }
    const r = await recordPayment(admin, {
      studentId: st.id, academicYearId: year.id, amount: p.amount,
      method: "CASH", paidAt: new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 25)),
      observation: "Règlement scolarité (démo)",
      idempotencyKey: `DEMO-PAY-${p.mat}-${p.amount}`,
    });
    note(`paiement ${p.mat} ${p.amount}${r.ok ? ` → ${r.result.receiptNumber}` : ` (${r.error})`}`, r.ok);
  }

  // ---------- Personnel RH ----------
  for (const e of EMPLOYEES) {
    let emp = await prisma.employee.findFirst({ where: { schoolId: sid, matricule: e.mat } });
    if (!emp) {
      const r = await createEmployee(rh, {
        matricule: e.mat, firstName: e.first, lastName: e.last, category: e.cat, hireDate: new Date("2026-09-01"),
      });
      if (r.ok) emp = await prisma.employee.findFirstOrThrow({ where: { id: r.result.id } });
      else { note(`employé ${e.first} ${e.last} (${r.error})`, false); continue; }
      note(`employé ${e.first} ${e.last}`, true);
    } else note(`employé ${e.first} ${e.last}`, false);
    const contract = await prisma.employeeContract.findFirst({ where: { employeeId: emp.id } });
    if (!contract) {
      // activate:true → dotations de congés provisionnées automatiquement (RH-9).
      const c = await createContract(rh, emp.id, {
        type: "CDI", position: e.pos, startDate: new Date("2026-09-01"), baseSalary: e.salary, activate: true,
      });
      note(`contrat CDI ${e.first} ${e.last} ${e.salary} F`, c.ok);
    }
  }

  // ---------- Règles de dotation + demande de congé en attente ----------
  await upsertLeaveRule(rh, "ANNUAL", 30);
  await upsertLeaveRule(rh, "SICK", 10);
  await provisionLeaveBalances(rh, now.getFullYear());
  note("dotations congés provisionnées", false);
  const emp1 = await prisma.employee.findFirstOrThrow({ where: { schoolId: sid, matricule: "D-P002" } });
  const pending = await prisma.leaveRequest.findFirst({
    where: { schoolId: sid, employeeId: emp1.id, status: "PENDING" },
  });
  if (!pending) {
    const lr = await requestLeave(rh, emp1.id, {
      type: "ANNUAL",
      startDate: new Date(now.getFullYear(), now.getMonth() + 1, 9),
      endDate: new Date(now.getFullYear(), now.getMonth() + 1, 13),
      reason: "Congés familiaux (démo — à approuver par le responsable RH)",
    });
    note("demande de congé en attente (à traiter dans /app/rh)", lr.ok);
  } else note("demande de congé en attente", false);

  // ---------- Dépenses ----------
  await ensureDefaultExpenseCategories(compta);
  const catFourn = await prisma.expenseCategory.findFirst({ where: { schoolId: sid } });
  const EXPENSES = [
    { label: "Fournitures de bureau — rentrée", amount: 85000, ben: "Librairie du Centre (fictif)" },
    { label: "Réfection tableau salle 3e A", amount: 45000, ben: "Menuiserie Sawadogo (fictif)" },
    { label: "Abonnement connexion internet", amount: 25000, ben: "Fournisseur Internet (fictif)" },
  ];
  for (const x of EXPENSES) {
    const exists = await prisma.expense.findFirst({ where: { schoolId: sid, label: x.label } });
    if (exists) { note(`dépense « ${x.label} »`, false); continue; }
    const r = await createExpense(compta, {
      categoryId: catFourn!.id, label: x.label, amount: x.amount, beneficiary: x.ben,
      academicYearId: year.id, expenseAt: now,
    });
    if (r.ok) {
      await payExpense(compta, r.result.id, { method: "CASH", paidAt: now });
      note(`dépense payée « ${x.label} »`, true);
    } else note(`dépense « ${x.label} » (${r.error})`, false);
  }

  // ---------- Portails : fiche enseignant + tuteur parent ----------
  // demo-enseignant : fiche Teacher reliée au compte (garde /teacher).
  const teacherUser = await prisma.user.findUniqueOrThrow({
    where: { email: "demo-enseignant@demo.ecomschool.test" }, select: { id: true },
  });
  const teacher = (await prisma.teacher.findFirst({ where: { schoolId: sid, userId: teacherUser.id } }))
    ?? await prisma.teacher.create({
      data: { schoolId: sid, userId: teacherUser.id, firstName: "Harmonie", lastName: "Kientega", status: "ACTIVE" },
    });
  note("fiche enseignant rattachée (demo-enseignant → /teacher)", false);

  // demo-parent : fiche Guardian reliée + rattachement à deux élèves.
  const parentUser = await prisma.user.findUniqueOrThrow({
    where: { email: "demo-parent@demo.ecomschool.test" }, select: { id: true },
  });
  const guardian = (await prisma.guardian.findFirst({ where: { schoolId: sid, userId: parentUser.id } }))
    ?? await prisma.guardian.create({
      data: {
        schoolId: sid, userId: parentUser.id,
        firstName: "Clémentine", lastName: "Ouédraogo", phone: "+226 70 00 00 00",
        email: "demo-parent@demo.ecomschool.test", status: "ACTIVE",
      },
    });
  const PARENT_CHILDREN = [
    { mat: "D-E001", rel: "MOTHER" as const },   // Awa Ouédraogo — mère
    { mat: "D-E003", rel: "GUARDIAN" as const }, // Mariam Compaoré — tutrice
  ];
  for (const pc of PARENT_CHILDREN) {
    const st = await prisma.student.findFirstOrThrow({ where: { schoolId: sid, matricule: pc.mat } });
    const link = await prisma.studentGuardian.findFirst({
      where: { schoolId: sid, studentId: st.id, guardianId: guardian.id, relation: pc.rel },
    });
    if (!link) {
      await prisma.studentGuardian.create({
        data: { schoolId: sid, studentId: st.id, guardianId: guardian.id, relation: pc.rel },
      });
      note(`lien parent ${pc.mat} (${pc.rel})`, true);
    } else note(`lien parent ${pc.mat} (${pc.rel})`, false);
  }

  // demo-eleve : fiche Student reliée au compte (garde /student).
  const eleveUser = await prisma.user.findUniqueOrThrow({
    where: { email: "demo-eleve@demo.ecomschool.test" }, select: { id: true },
  });
  const awa = await prisma.student.findFirstOrThrow({ where: { schoolId: sid, matricule: "D-E001" } });
  if (awa.userId !== eleveUser.id) {
    await prisma.student.update({ where: { id: awa.id }, data: { userId: eleveUser.id } });
    note("fiche élève rattachée (demo-eleve → /student, Awa)", true);
  } else note("fiche élève rattachée (demo-eleve)", false);

  // ---------- Pédagogie : périodes, matières, emploi du temps, notes ----------
  const period1 = (await prisma.academicPeriod.findFirst({
    where: { schoolId: sid, academicYearId: year.id, name: "Trimestre 1" },
  })) ?? await prisma.academicPeriod.create({
    data: {
      schoolId: sid, academicYearId: year.id, name: "Trimestre 1", number: 1,
      type: "TRIMESTER", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-20"),
    },
  });
  note(`période ${period1.name}`, false);

  const SUBJECTS = [
    { name: "Mathématiques", code: "MATH" }, { name: "Français", code: "FRA" },
    { name: "SVT", code: "SVT" }, { name: "Anglais", code: "ANG" },
    { name: "Histoire-Géographie", code: "HG" },
  ];
  const subjects: Record<string, string> = {};
  for (const su of SUBJECTS) {
    const row = (await prisma.subject.findFirst({ where: { schoolId: sid, name: su.name } }))
      ?? await prisma.subject.create({ data: { schoolId: sid, ...su } });
    subjects[su.code] = row.id;
  }
  note("5 matières", false);

  // Matières par classe (coefficients plausibles du secondaire).
  const classSubjects: { room: string; code: string; coef: number; teacher?: string }[] = [
    { room: "6e A", code: "MATH", coef: 4, teacher: teacher.id },
    { room: "6e A", code: "FRA", coef: 4 }, { room: "6e A", code: "HG", coef: 2 },
    { room: "5e A", code: "MATH", coef: 4, teacher: teacher.id },
    { room: "5e A", code: "FRA", coef: 4 }, { room: "5e A", code: "ANG", coef: 3 },
    { room: "4e A", code: "MATH", coef: 4 }, { room: "4e A", code: "SVT", coef: 3 },
    { room: "3e A", code: "MATH", coef: 4 }, { room: "3e A", code: "FRA", coef: 4 },
  ];
  for (const cs of classSubjects) {
    const exists = await prisma.classroomSubject.findFirst({
      where: { classroomId: rooms[cs.room].id, subjectId: subjects[cs.code] },
    });
    if (!exists) {
      await prisma.classroomSubject.create({
        data: {
          schoolId: sid, classroomId: rooms[cs.room].id, subjectId: subjects[cs.code],
          coefficient: cs.coef, teacherId: cs.teacher ?? null,
        },
      });
      note(`matière ${cs.code} → ${cs.room}`, true);
      if (cs.teacher) {
        await prisma.teachingAssignment.create({
          data: {
            schoolId: sid, teacherId: cs.teacher, classroomId: rooms[cs.room].id,
            subjectId: subjects[cs.code], academicYearId: year.id,
          },
        });
      }
    }
  }

  // Emploi du temps de la semaine pour l'enseignant démo (7h30=450 …).
  const SLOTS: { room: string; day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY"; start: number; end: number }[] = [
    { room: "6e A", day: "MONDAY", start: 450, end: 570 },
    { room: "6e A", day: "THURSDAY", start: 600, end: 720 },
    { room: "5e A", day: "TUESDAY", start: 480, end: 600 },
    { room: "5e A", day: "FRIDAY", start: 840, end: 960 },
  ];
  for (const sl of SLOTS) {
    const exists = await prisma.courseSchedule.findFirst({
      where: {
        schoolId: sid, academicYearId: year.id, classroomId: rooms[sl.room].id,
        teacherId: teacher.id, weekday: sl.day, startMin: sl.start,
      },
    });
    if (!exists) {
      await prisma.courseSchedule.create({
        data: {
          schoolId: sid, academicYearId: year.id, classroomId: rooms[sl.room].id,
          subjectId: subjects.MATH, teacherId: teacher.id,
          weekday: sl.day, startMin: sl.start, endMin: sl.end,
          validFrom: year.startDate,
        },
      });
      note(`créneau ${sl.room} ${sl.day} ${sl.start}–${sl.end}`, true);
    }
  }

  // Séances passées (DONE) et à venir (PLANNED) alignées sur les créneaux.
  const WD: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
  const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let back = -10; back <= 7; back++) {
    const d = new Date(now); d.setDate(d.getDate() + back);
    const wd = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][d.getDay()];
    const slot = SLOTS.find((s) => s.day === wd);
    if (!slot) continue;
    const sessionDate = day0(d);
    const exists = await prisma.courseSession.findFirst({
      where: { schoolId: sid, teacherId: teacher.id, date: sessionDate, startMin: slot.start },
    });
    if (exists) continue;
    const session = await prisma.courseSession.create({
      data: {
        schoolId: sid, academicYearId: year.id, classroomId: rooms[slot.room].id,
        subjectId: subjects.MATH, teacherId: teacher.id,
        date: sessionDate, startMin: slot.start, endMin: slot.end,
        status: back < 0 ? "DONE" : "PLANNED",
      },
    });
    if (back === -3) {
      await prisma.courseContent.create({
        data: {
          sessionId: session.id, theme: "Les fractions", chapter: "Chapitre 3",
          objective: "Additionner et comparer des fractions",
          content: "Rappels sur les fractions équivalentes, mise au même dénominateur, exercices d'application.",
          homework: "Exercices 12 à 15 page 42 (démo)",
        },
      });
    }
    note(`séance ${slot.room} ${sessionDate.toISOString().slice(0, 10)}`, true);
  }

  // Types d'évaluation + un devoir PUBLIÉ avec notes (visible portail parent).
  const devoir = (await prisma.assessmentType.findFirst({ where: { schoolId: sid, code: "DEVOIR" } }))
    ?? await prisma.assessmentType.create({
      data: { schoolId: sid, code: "DEVOIR", name: "Devoir surveillé", defaultCoefficient: 1 },
    });
  const assessDate = new Date(now); assessDate.setDate(assessDate.getDate() - 12);
  const assessment = (await prisma.assessment.findFirst({
    where: { schoolId: sid, title: { contains: "Devoir n°1 de Mathématiques" } },
  })) ?? await prisma.assessment.create({
    data: {
      schoolId: sid, academicYearId: year.id, academicPeriodId: period1.id,
      classroomId: rooms["6e A"].id, subjectId: subjects.MATH, teacherId: teacher.id,
      typeId: devoir.id, title: "Devoir n°1 de Mathématiques — 6e A",
      date: assessDate, maxScore: 20, coefficient: 2, status: "PUBLISHED",
      description: "Fractions et opérations (démo)",
    },
  });
  const enrolled6A = await prisma.enrollment.findMany({
    where: { schoolId: sid, classroomId: rooms["6e A"].id, academicYearId: year.id },
    select: { studentId: true },
  });
  const demoGrades = [14.5, 11, 16.5, 9.5, 13];
  for (let i = 0; i < enrolled6A.length; i++) {
    const g = await prisma.grade.findFirst({
      where: { schoolId: sid, assessmentId: assessment.id, studentId: enrolled6A[i].studentId },
    });
    if (!g) {
      await prisma.grade.create({
        data: {
          schoolId: sid, assessmentId: assessment.id, studentId: enrolled6A[i].studentId,
          value: demoGrades[i % demoGrades.length], status: "ENTERED",
        },
      });
    }
  }
  note(`devoir publié 6e A (${enrolled6A.length} notes)`, false);

  // Appels journaliers : une absence et un retard représentatifs.
  const DAILY: { mat: string; daysAgo: number; status: "ABSENT" | "LATE"; reason: string; dur?: number }[] = [
    { mat: "D-E003", daysAgo: 6, status: "ABSENT", reason: "Maladie (justificatif parental apporté)", dur: 480 },
    { mat: "D-E001", daysAgo: 3, status: "LATE", reason: "Transport", dur: 15 },
  ];
  for (const d of DAILY) {
    const st = await prisma.student.findFirstOrThrow({ where: { schoolId: sid, matricule: d.mat } });
    const date = new Date(now); date.setDate(date.getDate() - d.daysAgo);
    const day = day0(date);
    const exists = await prisma.attendanceRecord.findFirst({
      where: { schoolId: sid, studentId: st.id, date: day, sessionId: null },
    });
    if (!exists) {
      await prisma.attendanceRecord.create({
        data: {
          schoolId: sid, studentId: st.id, date: day, status: d.status,
          durationMin: d.dur, reason: d.reason, recordedById: admin.userId,
        },
      });
      note(`assiduité ${d.mat} ${d.status}`, true);
    }
  }

  // ---------- Annonce ----------
  const ann = await prisma.announcement.findFirst({
    where: { schoolId: sid, title: { contains: "conseil", mode: "insensitive" } },
  });
  if (!ann) {
    const a = await createAnnouncement(admin, {
      title: "Conseil d'école du premier trimestre",
      body: "Le conseil d'école se tiendra le samedi 12 décembre à 9 h en salle polyvalente. Ordre du jour : bilan pédagogique, finances et vie scolaire. (Annonce fictive de démonstration.)",
      audience: "ALL",
      publish: true,
    });
    note("annonce publiée (conseil d'école)", a.ok);
  } else note("annonce", false);

  console.log(`\n=== DONNÉES DÉMO : ${pass} contrôles, ${created} nouvelles entités ===`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
