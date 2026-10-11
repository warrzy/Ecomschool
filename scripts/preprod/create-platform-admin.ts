import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

/**
 * Création du compte propriétaire plateforme en préproduction.
 * Variables requises :
 *   PREPROD_PLATFORM_ADMIN_EMAIL
 *   PREPROD_PLATFORM_ADMIN_PASSWORD
 * Idempotent : ré-exécution réinitialise le mot de passe du compte.
 */
async function main() {
  const email = process.env.PREPROD_PLATFORM_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "PREPROD_PLATFORM_ADMIN_EMAIL et PREPROD_PLATFORM_ADMIN_PASSWORD requis",
    );
  }

  const role = await prisma.role.findFirstOrThrow({
    where: { name: "PLATFORM_OWNER", scope: "PLATFORM", schoolId: null },
    select: { id: true },
  });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: "ACTIVE" },
    create: {
      email,
      passwordHash,
      firstName: "Admin",
      lastName: "ECOM-TOUCH",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: user.id, roleId: role.id },
    },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });

  console.log(`Compte plateforme prêt : ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
