import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";

const DEMO_PASSWORD = "oZy75jToi1YJyHWCR70j5rIq";

async function roleId(name: string) {
  const r = await prisma.role.findFirst({ where: { name, scope: "SCHOOL", schoolId: null }, select: { id: true } });
  if (!r) throw new Error(`rôle ${name} absent`);
  return r.id;
}

async function schoolUser(schoolId: string, email: string, roleName: string, firstName: string, lastName: string) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await hashPassword(DEMO_PASSWORD), firstName, lastName, status: "ACTIVE", schoolId },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    update: { roleId: await roleId(roleName), status: "ACTIVE" },
    create: { userId: user.id, schoolId, roleId: await roleId(roleName), status: "ACTIVE" },
  });
  console.log(`  ${email} → ${roleName}`);
  return user.id;
}

async function main() {
  const school = await prisma.school.upsert({
    where: { code: "DEMO-ECOLE" },
    update: {},
    create: {
      name: "Collège Démo ECOM (données fictives)",
      code: "DEMO-ECOLE",
      slug: "demo-ecole",
      email: "contact@demo.local",
      city: "Ouagadougou",
    },
  });
  console.log(`école : ${school.name}`);

  await schoolUser(school.id, "admin@demo.local", "ADMIN_SCHOOL", "Admin", "Démo");
  await schoolUser(school.id, "enseignant@demo.local", "TEACHER", "Awa", "Kaboré");
  await schoolUser(school.id, "parent@demo.local", "PARENT", "Moussa", "Ouédraogo");
  await schoolUser(school.id, "eleve@demo.local", "STUDENT", "Aminata", "Ouédraogo");
  await schoolUser(school.id, "finance@demo.local", "FINANCE_MANAGER", "Issaka", "Traoré");
  await schoolUser(school.id, "caissier@demo.local", "CASHIER", "Rasmata", "Sawadogo");
  console.log("comptes démo créés (idempotent)");
}

main().finally(() => prisma.$disconnect());
