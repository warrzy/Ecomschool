import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const existing = await prisma.role.findFirst({
    where: {
      name: "PLATFORM_OWNER",
      scope: "PLATFORM",
      schoolId: null,
    },
    select: { id: true },
  });

  if (existing) {
    console.log(JSON.stringify({ ok: true, already: true }, null, 2));
    return;
  }

  const updated = await prisma.role.updateMany({
    where: {
      name: "SUPER_ADMIN",
      schoolId: null,
    },
    data: {
      name: "PLATFORM_OWNER",
      scope: "PLATFORM",
    },
  });

  console.log(JSON.stringify({ ok: true, updatedCount: updated.count }, null, 2));
}

main()
  .catch((e) => {
    console.error("RENAME_PLATFORM_OWNER_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
