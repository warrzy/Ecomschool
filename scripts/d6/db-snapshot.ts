import { prisma } from "../../src/lib/db/prisma";

async function main() {
  const roles = await prisma.role.findMany({
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });
  for (const r of roles) {
    console.log("ROLE", r.scope, r.name, r.schoolId ? `school:${r.schoolId}` : "global");
    console.log("  perms:", r.rolePermissions.map((rp) => rp.permission.key).sort().join(", "));
  }
  const mods = await prisma.platformModule.findMany({ orderBy: { code: "asc" } });
  for (const m of mods)
    console.log("MODULE", m.code, "|", m.name, "| deps:", m.dependsOn.join(","), "| commercial:", m.commercial);
  const plans = await prisma.subscriptionPlan.findMany({
    include: { modules: { include: { module: true } } },
    orderBy: { monthlyPrice: "asc" },
  });
  for (const p of plans) {
    console.log(
      "PLAN", p.code, "|", p.name, "| mensuel:", p.monthlyPrice, "| annuel:", p.yearlyPrice,
      "| maxStudents:", p.maxStudents, "| maxUsers:", p.maxUsers, "| trial:", p.trialDays, "| commercial:", p.commercial,
    );
    console.log("  modules:", p.modules.map((m) => m.module.code).sort().join(", "));
  }
  const subs = await prisma.schoolSubscription.findMany({ include: { plan: true, school: true } });
  for (const s of subs) console.log("SUB", s.school.name, "| plan:", s.plan.code, "| status:", s.status);
  const perms = await prisma.permission.findMany({ orderBy: { key: "asc" } });
  console.log("PERMISSIONS count:", perms.length);
  console.log(perms.map((p) => p.key).join("\n"));
}
main().finally(() => prisma.$disconnect());
