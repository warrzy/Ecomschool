import { prisma } from "@/lib/db/prisma";
async function main() {
  const s = await prisma.school.findUniqueOrThrow({ where: { slug: "demo-validation" } });
  const accs = await prisma.accountingAccount.findMany({ where: { schoolId: s.id }, select: { code: true }, orderBy: { code: "asc" } });
  console.log(s.id, "comptes:", accs.map(a => a.code).join(","));
  const runs = await prisma.payrollRun.findMany({ where: { schoolId: s.id }, select: { id: true, status: true, periodStart: true, periodEnd: true, postedEntryId: true, rectifiesRunId: true }, orderBy: { periodStart: "asc" } });
  console.log("runs:", JSON.stringify(runs));
  const exs = await prisma.accountingExercise.findMany({ where: { schoolId: s.id }, select: { name: true, status: true, startDate: true, endDate: true, mode: true } });
  console.log("exercices:", JSON.stringify(exs));
  await prisma.$disconnect();
}
main();
