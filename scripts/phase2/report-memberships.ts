import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const rows = await prisma.schoolMembership.findMany({
    select: {
      id: true,
      status: true,
      schoolId: true,
      userId: true,
      role: { select: { id: true, name: true, scope: true, schoolId: true } },
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
}

main()
  .catch((e) => {
    console.error("REPORT_MEMBERSHIPS_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
