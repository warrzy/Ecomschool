import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  getSchoolAssignableRole,
  userHasPlatformPermission,
  userHasSchoolPermission,
} from "@/lib/permissions/rbac";
import {
  createSchoolUser,
  removeSchoolUser,
  updateSchoolUser,
} from "@/lib/services/users";
import {
  assert,
  ensureDevServer,
  httpRequest,
  killDevServer,
  resolveTestPort,
  signIn,
} from "./lib/test-utils";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

const T = (email: string) => `${email}@ecom-test.local`;

async function ensureUser(input: {
  email: string;
  passwordHash: string;
  schoolId: string | null;
  status: "ACTIVE" | "DISABLED";
}) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        schoolId: input.schoolId,
        status: input.status,
        passwordHash: input.passwordHash,
      },
      select: { id: true },
    });
  }
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      schoolId: input.schoolId,
      status: input.status,
    },
    select: { id: true },
  });
}

async function ensureMembership(input: {
  userId: string;
  schoolId: string;
  roleId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  return prisma.schoolMembership.upsert({
    where: {
      schoolId_userId: { schoolId: input.schoolId, userId: input.userId },
    },
    update: { roleId: input.roleId, status: input.status },
    create: {
      userId: input.userId,
      schoolId: input.schoolId,
      roleId: input.roleId,
      status: input.status,
    },
    select: { id: true },
  });
}

async function main() {
  const seedPassword = process.env.SEED_TEST_PASSWORD;
  if (!seedPassword) throw new Error("SEED_TEST_PASSWORD is not set");

  const schoolA = await prisma.school.findUniqueOrThrow({
    where: { code: "WEND-PANGA" },
    select: { id: true },
  });

  const systemAdminRole = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });

  const platformOwnerRole = await prisma.role.findFirstOrThrow({
    where: { name: "PLATFORM_OWNER", scope: "PLATFORM", schoolId: null },
    select: { id: true },
  });

  const schoolAdminA = await prisma.user.findUniqueOrThrow({
    where: { email: "school-admin@ecom-school.local" },
    select: { id: true, schoolId: true },
  });

  const platformOwner = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@ecom-school.local" },
    select: { id: true },
  });

  // ---- Fixtures ----
  const passwordHash = await hashPassword(seedPassword);

  const schoolB = await prisma.school.upsert({
    where: { code: "TEST-SEC-B" },
    update: {},
    create: {
      name: "Ecole Test Securite B",
      code: "TEST-SEC-B",
      slug: "test-sec-b",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const roleB =
    (await prisma.role.findFirst({
      where: { name: "TEST_ROLE_B", scope: "SCHOOL", schoolId: schoolB.id },
      select: { id: true },
    })) ??
    (await prisma.role.create({
      data: { name: "TEST_ROLE_B", scope: "SCHOOL", schoolId: schoolB.id },
      select: { id: true },
    }));

  const noPermRole =
    (await prisma.role.findFirst({
      where: { name: "TEST_NOPERM", scope: "SCHOOL", schoolId: null },
      select: { id: true },
    })) ??
    (await prisma.role.create({
      data: { name: "TEST_NOPERM", scope: "SCHOOL", schoolId: null },
      select: { id: true },
    }));

  const bAdmin = await ensureUser({
    email: T("sec-b-admin"),
    passwordHash,
    schoolId: schoolB.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: bAdmin.id,
    schoolId: schoolB.id,
    roleId: systemAdminRole.id,
    status: "ACTIVE",
  });

  const bUser = await ensureUser({
    email: T("sec-b-user"),
    passwordHash,
    schoolId: schoolB.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: bUser.id,
    schoolId: schoolB.id,
    roleId: systemAdminRole.id,
    status: "ACTIVE",
  });

  const aNoPerm = await ensureUser({
    email: T("sec-a-noperm"),
    passwordHash,
    schoolId: schoolA.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: aNoPerm.id,
    schoolId: schoolA.id,
    roleId: noPermRole.id,
    status: "ACTIVE",
  });

  const suspended = await ensureUser({
    email: T("sec-suspended"),
    passwordHash,
    schoolId: schoolA.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: suspended.id,
    schoolId: schoolA.id,
    roleId: systemAdminRole.id,
    status: "INACTIVE",
  });

  const noMember = await ensureUser({
    email: T("sec-nomember"),
    passwordHash,
    schoolId: schoolA.id,
    status: "ACTIVE",
  });
  await prisma.schoolMembership.deleteMany({
    where: { userId: noMember.id, schoolId: schoolA.id },
  });

  const disabled = await ensureUser({
    email: T("sec-disabled"),
    passwordHash,
    schoolId: schoolA.id,
    status: "DISABLED",
  });

  const platformNoSchool = await ensureUser({
    email: T("sec-platform"),
    passwordHash,
    schoolId: null,
    status: "ACTIVE",
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: platformNoSchool.id, roleId: platformOwnerRole.id },
    },
    update: {},
    create: { userId: platformNoSchool.id, roleId: platformOwnerRole.id },
    select: { id: true },
  });

  const platformMember = await ensureUser({
    email: T("sec-platform-member"),
    passwordHash,
    schoolId: schoolA.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: platformMember.id,
    schoolId: schoolA.id,
    roleId: systemAdminRole.id,
    status: "ACTIVE",
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: platformMember.id,
        roleId: platformOwnerRole.id,
      },
    },
    update: {},
    create: { userId: platformMember.id, roleId: platformOwnerRole.id },
    select: { id: true },
  });

  const ctxA = { userId: schoolAdminA.id, schoolId: schoolA.id };

  try {
    // ---- Unit: rbac scope rules ----
    assert(
      await userHasSchoolPermission({
        userId: schoolAdminA.id,
        schoolId: schoolA.id,
        permissionKey: "user.manage",
      }),
      "school-admin should have user.manage in school A",
    );
    checks.push({ name: "rbac: admin A a user.manage dans son école", ok: true });

    assert(
      !(await userHasSchoolPermission({
        userId: schoolAdminA.id,
        schoolId: schoolB.id,
        permissionKey: "user.manage",
      })),
      "school-admin must NOT have permissions in school B",
    );
    checks.push({ name: "rbac: admin A n'a aucune permission dans B", ok: true });

    assert(
      !(await userHasSchoolPermission({
        userId: suspended.id,
        schoolId: schoolA.id,
        permissionKey: "user.read",
      })),
      "suspended membership must grant nothing",
    );
    checks.push({ name: "rbac: membership suspendu => refusé", ok: true });

    assert(
      !(await userHasSchoolPermission({
        userId: noMember.id,
        schoolId: schoolA.id,
        permissionKey: "user.read",
      })),
      "missing membership must grant nothing",
    );
    checks.push({ name: "rbac: sans membership => refusé", ok: true });

    assert(
      !(await userHasSchoolPermission({
        userId: aNoPerm.id,
        schoolId: schoolA.id,
        permissionKey: "user.manage",
      })),
      "role without permission must deny",
    );
    checks.push({ name: "rbac: permission manquante => refusé", ok: true });

    assert(
      !(await userHasSchoolPermission({
        userId: platformOwner.id,
        schoolId: schoolA.id,
        permissionKey: "school.read",
      })),
      "platform role must not grant school permission",
    );
    checks.push({
      name: "rbac: rôle PLATFORM ne donne pas de permission école",
      ok: true,
    });

    assert(
      !(await userHasPlatformPermission({
        userId: schoolAdminA.id,
        permissionKey: "platform.schools.manage",
      })),
      "school role must not grant platform permission",
    );
    checks.push({
      name: "rbac: rôle SCHOOL ne donne pas de permission plateforme",
      ok: true,
    });

    assert(
      await userHasPlatformPermission({
        userId: platformOwner.id,
        permissionKey: "platform.schools.manage",
      }),
      "platform owner should have platform.schools.manage",
    );
    checks.push({ name: "rbac: PLATFORM_OWNER a platform.schools.manage", ok: true });

    assert(
      !(await userHasPlatformPermission({
        userId: disabled.id,
        permissionKey: "platform.schools.manage",
      })),
      "disabled user must not have platform permission",
    );
    checks.push({ name: "rbac: compte désactivé => refusé", ok: true });

    // ---- Role assignability ----
    assert(
      (await getSchoolAssignableRole({
        roleId: systemAdminRole.id,
        schoolId: schoolA.id,
      })) !== null,
      "system school role must be assignable",
    );
    checks.push({ name: "roles: rôle système SCHOOL assignable", ok: true });

    assert(
      (await getSchoolAssignableRole({
        roleId: platformOwnerRole.id,
        schoolId: schoolA.id,
      })) === null,
      "platform role must not be assignable in a school",
    );
    checks.push({ name: "roles: rôle PLATFORM non assignable en école", ok: true });

    assert(
      (await getSchoolAssignableRole({
        roleId: roleB.id,
        schoolId: schoolA.id,
      })) === null,
      "role of school B must not be assignable in school A",
    );
    checks.push({ name: "roles: rôle d'une autre école refusé", ok: true });

    // ---- Services: cross-tenant enforcement ----
    const crossUpdate = await updateSchoolUser(ctxA, {
      id: bUser.id,
      email: T("sec-b-user"),
      status: "DISABLED",
    });
    assert(!crossUpdate.ok && crossUpdate.error === "NOT_FOUND",
      "cross-tenant update must be NOT_FOUND");
    checks.push({ name: "service: update par ID étranger => NOT_FOUND", ok: true });

    const platformUpdate = await updateSchoolUser(ctxA, {
      id: platformMember.id,
      email: T("sec-platform-member"),
      status: "DISABLED",
    });
    assert(
      !platformUpdate.ok && platformUpdate.error === "CANNOT_TARGET_PLATFORM_USER",
      "platform user must be unmanageable from school",
    );
    checks.push({
      name: "service: admin école ne peut pas modifier un compte plateforme",
      ok: true,
    });

    const crossDelete = await removeSchoolUser(ctxA, bUser.id);
    assert(!crossDelete.ok && crossDelete.error === "NOT_FOUND",
      "cross-tenant delete must be NOT_FOUND");
    checks.push({ name: "service: suppression cross-tenant => NOT_FOUND", ok: true });

    const selfDelete = await removeSchoolUser(ctxA, ctxA.userId);
    assert(!selfDelete.ok && selfDelete.error === "CANNOT_TARGET_SELF",
      "self delete must be refused");
    checks.push({ name: "service: suppression de soi => refusé", ok: true });

    const platformRoleCreate = await createSchoolUser(ctxA, {
      email: T("sec-should-not-exist"),
      password: seedPassword,
      status: "ACTIVE",
      roleId: platformOwnerRole.id,
    });
    assert(
      !platformRoleCreate.ok && platformRoleCreate.error === "INVALID_ROLE",
      "platform role must not be usable for school user",
    );
    checks.push({
      name: "service: création avec rôle PLATFORM => INVALID_ROLE",
      ok: true,
    });

    const crossRoleCreate = await createSchoolUser(ctxA, {
      email: T("sec-should-not-exist-2"),
      password: seedPassword,
      status: "ACTIVE",
      roleId: roleB.id,
    });
    assert(
      !crossRoleCreate.ok && crossRoleCreate.error === "INVALID_ROLE",
      "role of another school must be refused",
    );
    checks.push({
      name: "service: création avec rôle d'école B => INVALID_ROLE",
      ok: true,
    });

    const validCreate = await createSchoolUser(ctxA, {
      email: T("sec-created"),
      password: seedPassword,
      status: "ACTIVE",
      roleId: systemAdminRole.id,
    });
    assert(validCreate.ok, "valid create should succeed");
    if (validCreate.ok) {
      const m = await prisma.schoolMembership.findFirst({
        where: { userId: validCreate.result.id, schoolId: schoolA.id, status: "ACTIVE" },
      });
      assert(!!m, "created user must have an ACTIVE membership in the school");
    }
    checks.push({
      name: "service: création valide => user + membership ACTIVE",
      ok: true,
    });

    // ---- HTTP: page-level enforcement ----
    const port = resolveTestPort();
    const { child, baseUrl } = await ensureDevServer(port);

    try {
      const adminA = await signIn({
        baseUrl,
        email: "school-admin@ecom-school.local",
        password: seedPassword,
      });
      const r1 = await httpRequest(`${baseUrl}/`, { method: "GET" }, adminA.jar);
      assert(r1.headers.location?.startsWith("/app") === true,
        `admin A root should redirect to /app, got ${r1.headers.location}`);
      checks.push({ name: "http: admin école => /app", ok: true });

      const r2 = await httpRequest(`${baseUrl}/app/users`, { method: "GET" }, adminA.jar);
      assert(r2.status === 200, `admin A GET /app/users expected 200 got ${r2.status}`);
      checks.push({ name: "http: admin A accède à ses utilisateurs", ok: true });

      const r3 = await httpRequest(`${baseUrl}/platform`, { method: "GET" }, adminA.jar);
      const loc3 = r3.headers.location;
      assert(
        r3.status !== 200 && typeof loc3 === "string" && loc3.startsWith("/app"),
        `admin A GET /platform expected redirect to /app, got status=${r3.status} loc=${loc3}`,
      );
      checks.push({ name: "http: admin école sur /platform => refusé", ok: true });

      const r4 = await httpRequest(
        `${baseUrl}/app/users/${bUser.id}/edit`,
        { method: "GET" },
        adminA.jar,
      );
      assert(
        r4.headers.location === "/app/users" ||
          r4.headers.location?.endsWith("/app/users") === true,
        `cross-tenant edit page must redirect to /app/users, got ${r4.headers.location}`,
      );
      checks.push({
        name: "http: édition d'un user de l'école B => refusé",
        ok: true,
      });

      const bAdminSession = await signIn({
        baseUrl,
        email: T("sec-b-admin"),
        password: seedPassword,
      });
      const r5 = await httpRequest(
        `${baseUrl}/app/users/${schoolAdminA.id}/edit`,
        { method: "GET" },
        bAdminSession.jar,
      );
      assert(
        r5.headers.location === "/app/users" ||
          r5.headers.location?.endsWith("/app/users") === true,
        `B admin editing A user must redirect, got ${r5.headers.location}`,
      );
      checks.push({
        name: "http: admin B édite user de A => refusé",
        ok: true,
      });

      const suspendedSession = await signIn({
        baseUrl,
        email: T("sec-suspended"),
        password: seedPassword,
      });
      const r6 = await httpRequest(`${baseUrl}/app`, { method: "GET" }, suspendedSession.jar);
      assert(
        r6.headers.location?.startsWith("/app/onboarding") === true,
        `suspended member should land on /app/onboarding, got ${r6.headers.location}`,
      );
      checks.push({ name: "http: membership suspendu => onboarding", ok: true });

      const noMemberSession = await signIn({
        baseUrl,
        email: T("sec-nomember"),
        password: seedPassword,
      });
      const r7 = await httpRequest(`${baseUrl}/app`, { method: "GET" }, noMemberSession.jar);
      assert(
        r7.headers.location?.startsWith("/app/onboarding") === true,
        `no-membership user should land on /app/onboarding, got ${r7.headers.location}`,
      );
      checks.push({ name: "http: sans membership => onboarding", ok: true });

      const noPermSession = await signIn({
        baseUrl,
        email: T("sec-a-noperm"),
        password: seedPassword,
      });
      const r8 = await httpRequest(`${baseUrl}/app/users`, { method: "GET" }, noPermSession.jar);
      assert(
        r8.headers.location === "/app" ||
          r8.headers.location?.endsWith("/app") === true,
        `missing permission should redirect to /app, got ${r8.headers.location}`,
      );
      checks.push({ name: "http: permission manquante => refusé", ok: true });

      const badLogin = await signIn({
        baseUrl,
        email: T("sec-disabled"),
        password: seedPassword,
      });
      assert(
        badLogin.status === 401 &&
          badLogin.callbackBody.toLowerCase().includes("error"),
        `disabled user login should fail, got status=${badLogin.status} body=${badLogin.callbackBody}`,
      );
      checks.push({ name: "http: compte désactivé => login refusé", ok: true });

      const platformSession = await signIn({
        baseUrl,
        email: T("sec-platform"),
        password: seedPassword,
      });
      const r9 = await httpRequest(`${baseUrl}/`, { method: "GET" }, platformSession.jar);
      assert(
        r9.headers.location?.startsWith("/platform") === true,
        `platform user without schoolId should redirect to /platform, got ${r9.headers.location}`,
      );
      checks.push({
        name: "http: compte plateforme sans schoolId => /platform",
        ok: true,
      });

      const r10 = await httpRequest(
        `${baseUrl}/app`,
        { method: "GET" },
        platformSession.jar,
      );
      assert(
        r10.headers.location?.startsWith("/platform") === true,
        `platform user on /app should redirect to /platform, got ${r10.headers.location}`,
      );
      checks.push({ name: "http: plateforme sur /app => /platform", ok: true });

      const anonJar = {};
      const r11 = await httpRequest(`${baseUrl}/app/users`, { method: "GET" }, anonJar);
      assert(
        r11.headers.location?.startsWith("/login") === true ||
          r11.headers.location?.includes("/login") === true,
        `anonymous should redirect to /login, got ${r11.headers.location}`,
      );
      checks.push({ name: "http: anonyme => /login", ok: true });
    } finally {
      await killDevServer(child);
    }
  } finally {
    // ---- Cleanup fixtures ----
    const fixtureUserIds = [
      bAdmin.id,
      bUser.id,
      aNoPerm.id,
      suspended.id,
      noMember.id,
      disabled.id,
      platformNoSchool.id,
      platformMember.id,
    ];
    const createdUser = await prisma.user.findUnique({
      where: { email: T("sec-created") },
      select: { id: true },
    });
    if (createdUser) fixtureUserIds.push(createdUser.id);

    await prisma.schoolMembership.deleteMany({
      where: { userId: { in: fixtureUserIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: fixtureUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.schoolMembership.deleteMany({
      where: { schoolId: schoolB.id },
    });
    await prisma.role.deleteMany({ where: { id: { in: [roleB.id, noPermRole.id] } } });
    await prisma.school.delete({ where: { id: schoolB.id } });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, total: checks.length, failed: failed.length, checks }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("SECURITY_TEST_FAILED");
  console.error(e);
  if (checks.length) {
    console.error(JSON.stringify({ checks }, null, 2));
  }
  process.exit(1);
});
