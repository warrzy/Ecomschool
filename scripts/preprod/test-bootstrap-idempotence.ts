import "dotenv/config";
import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import bcrypt from "bcryptjs";

/**
 * Test d'idempotence — scripts/preprod/create-platform-admin.ts
 *
 * Scénarios :
 *  1. Compte absent → création ACTIVE, hash bcrypt vérifiable.
 *  2. Compte existant (hash modifié) → hash et statut inchangés.
 *  3. Compte DISABLED → reste DISABLED après ré-exécution.
 *  4. Ré-exécutions → un seul compte, un seul UserRole.
 *  5. Aucun autre compte touché.
 *
 * Usage : npx tsx scripts/preprod/test-bootstrap-idempotence.ts
 * ATTENTION : écrit un utilisateur de test dans la base DATABASE_URL,
 * puis le supprime en fin de test.
 */

const EMAIL = "bootstrap-idempotence@test.local";
const PASSWORD = "Test-Only-Password-Not-Real";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

function runScript() {
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/preprod/create-platform-admin.ts"],
    {
      env: {
        ...process.env,
        PREPROD_PLATFORM_ADMIN_EMAIL: EMAIL,
        PREPROD_PLATFORM_ADMIN_PASSWORD: PASSWORD,
      },
      stdio: "pipe",
    },
  );
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (u) {
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}

async function main() {
  const role = await prisma.role.findFirstOrThrow({
    where: { name: "PLATFORM_OWNER", scope: "PLATFORM", schoolId: null },
  });

  await cleanup();

  // ── 1. Compte absent → création
  runScript();
  const created = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { userRoles: true },
  });
  check("compte créé", !!created);
  check("statut ACTIVE", created?.status === "ACTIVE");
  check(
    "hash bcrypt vérifiable",
    !!created && (await bcrypt.compare(PASSWORD, created.passwordHash)),
  );
  check(
    "rôle PLATFORM_OWNER attribué",
    created?.userRoles.some((r) => r.roleId === role.id) ?? false,
  );

  // ── 2. Compte existant avec hash modifié → inchangé
  const manualHash = await hashPassword("autre-valeur-manuelle");
  await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash: manualHash },
  });
  runScript();
  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  check("mot de passe NON réinitialisé", user?.passwordHash === manualHash);
  check("statut ACTIVE conservé", user?.status === "ACTIVE");

  // ── 3. Compte DISABLED → reste DISABLED
  await prisma.user.update({
    where: { email: EMAIL },
    data: { status: "DISABLED" },
  });
  runScript();
  user = await prisma.user.findUnique({ where: { email: EMAIL } });
  check("statut DISABLED conservé", user?.status === "DISABLED");
  check("hash toujours inchangé", user?.passwordHash === manualHash);

  // ── 4. Ré-exécutions → pas de doublon
  runScript();
  runScript();
  const count = await prisma.user.count({ where: { email: EMAIL } });
  check("un seul compte pour cet email", count === 1);
  const roleCount = await prisma.userRole.count({
    where: { user: { email: EMAIL }, roleId: role.id },
  });
  check("un seul UserRole PLATFORM_OWNER", roleCount === 1);

  // ── 5. Aucun autre compte touché
  const others = await prisma.user.count({
    where: { email: { contains: "bootstrap-idempotence" }, NOT: { email: EMAIL } },
  });
  check("aucun compte parasite créé", others === 0);

  await cleanup();
  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
