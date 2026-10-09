import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const tableNames = [
    "School",
    "User",
    "Role",
    "Permission",
    "UserRole",
    "RolePermission",
    "AcademicYear",
    "AcademicPeriod",
    "_prisma_migrations",
  ] as const;

  const counts: Record<string, number> = {};

  for (const t of tableNames) {
    const rows = (await prisma.$queryRawUnsafe(
      `select count(*)::int as n from \"${t}\"`,
    )) as Array<{ n: number }>;
    counts[t] = rows[0]?.n ?? 0;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    counts,
  };

  writeFileSync(
    "backups/counts_before.json",
    JSON.stringify(output, null, 2),
    "utf8",
  );

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error("COUNTS_BEFORE_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
