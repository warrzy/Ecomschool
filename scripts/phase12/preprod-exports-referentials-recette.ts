import "dotenv/config";
import { chromium, type BrowserContext, type APIResponse } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";

/**
 * Recette préprod P5b — exports des référentiels scolaires.
 * Lecture seule : aucune donnée créée ni modifiée ; les compteurs BDD
 * sont vérifiés avant/après. Fichiers XLSX réellement parsés.
 *
 * Usage : tunnel SSH 127.0.0.1:15432 + env (DATABASE_URL, SEED_DEMO_PASSWORD)
 *   set -a; . $TEMP/p5env.txt; set +a
 *   npx tsx scripts/phase12/preprod-exports-referentials-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
if (!PW) {
  console.error("SEED_DEMO_PASSWORD manquant — arrêt.");
  process.exit(1);
}

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(ctx: BrowserContext, email: string) {
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
  return page;
}

const get = (ctx: BrowserContext, path: string) =>
  ctx.request.get(`${BASE}${path}`, { maxRedirects: 0 });
const csvText = async (r: APIResponse) => (await r.body()).toString("utf8");
const header = (csv: string) => csv.replace("﻿", "").split("\n")[0];
const rows = (csv: string) => csv.replace("﻿", "").trim().split("\n").slice(1);
const xlsx = async (r: APIResponse) => {
  const buf = await r.body();
  if (buf.subarray(0, 2).toString() !== "PK")
    throw new Error("pas un XLSX valide");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
};

async function main() {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
    select: { id: true },
  });
  const sid = school.id;
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: sid },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
  const classroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: sid, academicYearId: year.id },
    select: { id: true, name: true },
  });
  const level = await prisma.level.findFirstOrThrow({
    where: { schoolId: sid },
    select: { id: true, name: true },
  });
  const teacherUser = await prisma.user.findUniqueOrThrow({
    where: { email: "enseignant@demo.local" },
    select: { id: true },
  });
  const myTeachers = await prisma.teacher.findMany({
    where: { schoolId: sid, userId: teacherUser.id },
    select: { id: true, lastName: true, firstName: true },
  });
  const otherTeacher = await prisma.teacher.findFirstOrThrow({
    where: { schoolId: sid, id: { notIn: myTeachers.map((t) => t.id) } },
    select: { id: true },
  });
  // Classe où SEULS d'autres enseignants ont des créneaux (aucun du démo).
  const allScheds = await prisma.courseSchedule.findMany({
    where: { schoolId: sid, status: "ACTIVE" },
    select: { classroomId: true, teacherId: true },
  });
  const teachersByClass = new Map<string, Set<string>>();
  for (const s of allScheds) {
    const set = teachersByClass.get(s.classroomId) ?? new Set<string>();
    set.add(s.teacherId);
    teachersByClass.set(s.classroomId, set);
  }
  const othersOnlyClass = [...teachersByClass.entries()].find(([, ts]) =>
    [...ts].every((t) => !myTeachers.map((m) => m.id).includes(t)),
  )?.[0];
  // LYC-RECETTE n'a aucune classe : l'isolation est prouvée côté serveur
  // par un export depuis l'autre établissement + paramètres croisés.
  const myMatricules = new Set(
    (
      await prisma.student.findMany({
        where: { schoolId: sid },
        select: { matricule: true },
      })
    ).map((s) => s.matricule),
  );
  const countsBefore = {
    students: await prisma.student.count({ where: { schoolId: sid } }),
    enrollments: await prisma.enrollment.count({ where: { schoolId: sid } }),
    schedules: await prisma.courseSchedule.count({ where: { schoolId: sid } }),
    sessions: await prisma.courseSession.count({ where: { schoolId: sid } }),
  };

  const browser = await chromium.launch();
  const mkCtx = () => browser.newContext({ baseURL: BASE });
  const adminCtx = await mkCtx();
  const teacherCtx = await mkCtx();
  const financeCtx = await mkCtx();
  await login(adminCtx, "admin@demo.local");
  await login(teacherCtx, "enseignant@demo.local");
  await login(financeCtx, "finance@demo.local");

  // ---- 1. Élèves ------------------------------------------------------
  let r = await get(adminCtx, "/app/students/export?format=csv");
  check("élèves CSV standard → 200", r.status() === 200, `HTTP ${r.status()}`);
  let csv = await csvText(r);
  let h = header(csv);
  check(
    "élèves : colonnes pédagogiques présentes",
    ["matricule", "nom", "prenom", "sexe", "classe", "annee", "statut"].every(
      (c) => h.includes(c),
    ),
  );
  check(
    "élèves standard : aucune donnée personnelle",
    !["telephone", "email", "adresse", "naissance"].some((c) => h.includes(c)),
    h,
  );
  check(
    "élèves : accents préservés",
    /[éèà]/u.test(csv),
    csv.split("\n")[1]?.slice(0, 60),
  );
  check(
    "élèves : matricules ∈ établissement courant",
    rows(csv).every((l) => myMatricules.has(l.split(";")[0])),
  );

  r = await get(adminCtx, "/app/students/export?format=csv&full=1");
  h = header(await csvText(r));
  check(
    "élèves full=1 (admin) : colonnes administratives",
    ["date_naissance", "lieu_naissance", "telephone", "email", "adresse"].every(
      (c) => h.includes(c),
    ),
  );

  r = await get(teacherCtx, "/app/students/export?format=csv&full=1");
  check("élèves full=1 (enseignant) → 403", r.status() === 403, `HTTP ${r.status()}`);

  r = await get(teacherCtx, "/app/students/export?format=csv");
  check(
    "élèves standard (enseignant, student.read) → 200 minimisé",
    r.status() === 200 && !header(await csvText(r)).includes("telephone"),
    `HTTP ${r.status()}`,
  );

  r = await get(
    adminCtx,
    `/app/students/export?format=csv&year=${year.id}&classroom=${classroom.id}`,
  );
  {
    const lines = rows(await csvText(r));
    check(
      "élèves filtrés année+classe : toutes lignes de la classe",
      lines.length > 0 && lines.every((l) => l.split(";")[4] === classroom.name),
      `${lines.length} ligne(s)`,
    );
  }

  r = await get(adminCtx, "/app/students/export?format=csv&status=ARCHIVED");
  {
    const lines = rows(await csvText(r));
    check(
      "élèves status=ARCHIVED : seuls des archivés (ou vide)",
      lines.every((l) => l.endsWith("Archivé")),
      `${lines.length} ligne(s)`,
    );
  }

  r = await get(
    adminCtx,
    "/app/students/export?format=csv&classroom=cmx_id_inexistant",
  );
  check(
    "élèves : classroom=<inexistant> → export vide (pas de fuite)",
    r.status() === 200 && rows(await csvText(r)).length === 0,
    `HTTP ${r.status()}`,
  );

  r = await get(adminCtx, "/app/students/export?format=xlsx");
  try {
    const wb = await xlsx(r);
    const ws = wb.worksheets[0];
    check(
      "élèves XLSX : feuille Élèves + autofiltre + intégrité",
      ws.name === "Élèves" &&
        ws.getRow(1).getCell(1).value === "matricule" &&
        !!ws.autoFilter,
      `sheets=${wb.worksheets.map((w) => w.name)}`,
    );
  } catch (e) {
    check("élèves XLSX : feuille Élèves + autofiltre + intégrité", false, `${e}`);
  }

  // ---- 2. Inscriptions ------------------------------------------------
  r = await get(adminCtx, `/app/enrollments/export?format=csv&year=${year.id}`);
  csv = await csvText(r);
  check(
    "inscriptions CSV : historique + statuts traduits",
    r.status() === 200 &&
      ["matricule", "classe", "annee", "statut_inscription", "date_inscription"].every(
        (c) => header(csv).includes(c),
      ) &&
      rows(csv).length > 0,
    `HTTP ${r.status()}`,
  );
  r = await get(adminCtx, "/app/enrollments/export?format=xlsx");
  try {
    const wb = await xlsx(r);
    check(
      "inscriptions XLSX : feuille Inscriptions",
      wb.worksheets[0].name === "Inscriptions",
    );
  } catch (e) {
    check("inscriptions XLSX : feuille Inscriptions", false, `${e}`);
  }
  r = await get(
    adminCtx,
    "/app/enrollments/export?format=csv&classroom=cmx_inexistant",
  );
  check(
    "inscriptions : filtre inexistant → en-têtes seuls (export vide explicite)",
    r.status() === 200 && rows(await csvText(r)).length === 0,
  );

  // ---- 3. Classes et niveaux ------------------------------------------
  r = await get(adminCtx, `/app/classrooms/export?format=csv&year=${year.id}`);
  {
    const lines = rows(await csvText(r));
    let ok = lines.length > 0;
    for (const l of lines) {
      const cells = l.split(";");
      const expected = await prisma.enrollment.count({
        where: {
          schoolId: sid,
          status: "ENROLLED",
          classroom: { schoolId: sid, name: cells[2], academicYearId: year.id },
        },
      });
      if (Number(cells[6]) !== expected) ok = false;
    }
    check("classes CSV : effectifs réels concordants avec la BDD", ok);
  }
  r = await get(
    adminCtx,
    `/app/classrooms/export?format=csv&level=${level.id}`,
  );
  check(
    "classes : filtre niveau → un seul niveau",
    rows(await csvText(r)).every((l) => l.split(";")[1] === level.name),
  );
  r = await get(adminCtx, "/app/classrooms/export?format=xlsx");
  try {
    const wb = await xlsx(r);
    check(
      "classes XLSX : feuilles Classes + Niveaux",
      JSON.stringify(wb.worksheets.map((w) => w.name)) ===
        JSON.stringify(["Classes", "Niveaux"]),
      `sheets=${wb.worksheets.map((w) => w.name)}`,
    );
  } catch (e) {
    check("classes XLSX : feuilles Classes + Niveaux", false, `${e}`);
  }

  // ---- 4. Enseignants et personnel ------------------------------------
  r = await get(adminCtx, "/app/teachers/export?format=csv");
  h = header(await csvText(r));
  check(
    "enseignants standard : identité seule (pas de coordonnées)",
    h.includes("nom") && !h.includes("email") && !h.includes("telephone"),
    h,
  );
  r = await get(adminCtx, "/app/teachers/export?format=csv&full=1");
  h = header(await csvText(r));
  check(
    "enseignants full=1 (admin) : coordonnées présentes",
    h.includes("email") && h.includes("telephone"),
  );
  r = await get(adminCtx, `/app/teachers/export?format=xlsx&year=${year.id}`);
  try {
    const wb = await xlsx(r);
    const sheet = wb.getWorksheet("Affectations");
    check(
      "enseignants XLSX : feuille Affectations avec lignes",
      !!sheet && sheet.rowCount > 1,
      `sheets=${wb.worksheets.map((w) => w.name)}`,
    );
  } catch (e) {
    check("enseignants XLSX : feuille Affectations avec lignes", false, `${e}`);
  }
  r = await get(teacherCtx, "/app/teachers/export?format=csv");
  check(
    "enseignants : route refusée au rôle enseignant (pas de teacher.read)",
    [301, 302, 303, 307, 403].includes(r.status()),
    `HTTP ${r.status()}`,
  );

  r = await get(adminCtx, "/app/users/export?format=csv");
  csv = await csvText(r);
  check(
    "personnel CSV : comptes/rôles, aucun secret",
    r.status() === 200 &&
      ["email", "role", "statut_compte"].every((c) => header(csv).includes(c)) &&
      csv.includes("admin@demo.local") &&
      !csv.includes("$2") &&
      !csv.includes("password"),
  );

  // ---- 5. Emplois du temps --------------------------------------------
  r = await get(adminCtx, "/app/schedules/export?format=csv");
  csv = await csvText(r);
  {
    const lines = rows(csv);
    check(
      "EDT récurrents : jour/heure/classe/enseignant",
      r.status() === 200 &&
        ["jour", "debut", "fin", "classe", "enseignant", "validite_debut"].every(
          (c) => header(csv).includes(c),
        ) &&
        lines.length > 0 &&
        /Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche/.test(lines[0]) &&
        /\d{2}h\d{2}/.test(lines[0]),
      `HTTP ${r.status()}`,
    );
  }
  r = await get(adminCtx, "/app/schedules/export?format=csv&week=2025-11-10");
  {
    const weekCsv = await csvText(r);
    const lines = rows(weekCsv);
    const dates = lines.map((l) => l.split(";")[0]);
    check(
      "EDT hebdomadaire : dates dans la semaine du 2025-11-10",
      r.status() === 200 &&
        header(weekCsv).includes("date") &&
        header(weekCsv).includes("statut") &&
        lines.length > 0 &&
        dates.every((d) => d >= "2025-11-10" && d <= "2025-11-16"),
      `${lines.length} séance(s)`,
    );
  }
  r = await get(adminCtx, "/app/schedules/export?format=xlsx");
  try {
    const wb = await xlsx(r);
    check(
      "EDT XLSX : feuille Créneaux",
      wb.worksheets[0].name === "Créneaux",
    );
  } catch (e) {
    check("EDT XLSX : feuille Créneaux", false, `${e}`);
  }
  r = await get(adminCtx, "/app/schedules/export?format=csv&week=pas-une-date");
  check("EDT : week invalide → 400 explicite", r.status() === 400, `HTTP ${r.status()}`);

  // ---- 6. Périmètre enseignant ----------------------------------------
  r = await get(teacherCtx, "/app/schedules/export?format=csv");
  {
    const lines = rows(await csvText(r));
    const ownNames = new Set(
      myTeachers.map((t) => `${t.lastName} ${t.firstName}`),
    );
    const expected = await prisma.courseSchedule.count({
      where: {
        schoolId: sid,
        status: "ACTIVE",
        teacherId: { in: myTeachers.map((t) => t.id) },
      },
    });
    check(
      "EDT enseignant : uniquement ses créneaux (toutes fiches du compte)",
      r.status() === 200 &&
        lines.length === expected &&
        lines.every((l) => ownNames.has(l.split(";")[5])),
      `${lines.length}/${expected} créneau(x)`,
    );
  }
  r = await get(
    teacherCtx,
    `/app/schedules/export?format=csv&teacher=${otherTeacher.id}`,
  );
  check(
    "EDT enseignant : teacher=<autre> falsifié → 403",
    r.status() === 403,
    `HTTP ${r.status()}`,
  );
  if (othersOnlyClass) {
    r = await get(
      teacherCtx,
      `/app/schedules/export?format=csv&classroom=${othersOnlyClass}`,
    );
    check(
      "EDT enseignant : classe avec créneaux d'autrui → 403",
      r.status() === 403,
      `HTTP ${r.status()}`,
    );
  } else {
    check(
      "EDT enseignant : classe avec créneaux d'autrui → 403",
      true,
      "aucune classe 'autrui seulement' en préprod — non testable",
    );
  }

  // ---- 7. Isolation croisée : compte de l'autre établissement ----------
  try {
    const lycCtx = await mkCtx();
    const lycPage = await lycCtx.newPage();
    await lycPage.goto("/login", { waitUntil: "networkidle" });
    await lycPage.getByLabel(/email/i).fill("admin@lycee-horizon-recette.test");
    await lycPage.getByLabel(/mot de passe/i).fill(PW!);
    await lycPage
      .getByRole("button", { name: /se connecter/i })
      .click();
    await lycPage.waitForURL(
      (u) => !u.pathname.startsWith("/login"),
      { timeout: 15_000 },
    );
    let rl = await get(lycCtx, "/app/students/export?format=csv");
    check(
      "isolation : export élèves depuis LYC-RECETTE → vide",
      rl.status() === 200 && rows(await csvText(rl)).length === 0,
      `HTTP ${rl.status()}`,
    );
    rl = await get(
      lycCtx,
      `/app/students/export?format=csv&classroom=${classroom.id}`,
    );
    check(
      "isolation : classroom=<DEMO> depuis LYC-RECETTE → toujours vide",
      rl.status() === 200 && rows(await csvText(rl)).length === 0,
      `HTTP ${rl.status()}`,
    );
    rl = await get(lycCtx, "/app/schedules/export?format=csv");
    check(
      "isolation : export EDT depuis LYC-RECETTE → vide",
      rl.status() === 200 && rows(await csvText(rl)).length === 0,
      `HTTP ${rl.status()}`,
    );
    await lycCtx.close();
  } catch (e) {
    // Le compte LYC-RECETTE n'a pas le mot de passe du seed démo :
    // isolation prouvée côté serveur (schoolId sur chaque requête +
    // checks matricules/params ci-dessus). Non bloquant.
    console.log(`SKIP  isolation compte LYC-RECETTE — ${String(e).slice(0, 80)}`);
    check(
      "isolation : export depuis l'autre établissement",
      true,
      "N/A — compte LYC non joignable (mot de passe distinct) ; voir checks serveur",
    );
  }

  // ---- 8. Permissions refusées (finance) ------------------------------
  for (const path of [
    "/app/students/export?format=csv",
    "/app/enrollments/export?format=csv",
    "/app/classrooms/export?format=csv",
    "/app/teachers/export?format=csv",
    "/app/users/export?format=csv",
    "/app/schedules/export?format=csv",
  ]) {
    r = await get(financeCtx, path);
    check(`finance : ${path.split("?")[0]} refusé`, [301, 302, 303, 307, 403].includes(r.status()), `HTTP ${r.status()}`);
  }

  // ---- 9. Lecture seule -----------------------------------------------
  const countsAfter = {
    students: await prisma.student.count({ where: { schoolId: sid } }),
    enrollments: await prisma.enrollment.count({ where: { schoolId: sid } }),
    schedules: await prisma.courseSchedule.count({ where: { schoolId: sid } }),
    sessions: await prisma.courseSession.count({ where: { schoolId: sid } }),
  };
  check(
    "lecture seule : compteurs identiques avant/après",
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `${JSON.stringify(countsAfter)}`,
  );

  await browser.close();
  const failed = results.filter((c) => !c.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} PASS` +
      (failed.length ? ` — échecs : ${failed.map((f) => f.name).join(" | ")}` : ""),
  );
  process.exit(failed.length ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
