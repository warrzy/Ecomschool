import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const rows = (await prisma.$queryRaw`select version() as version`) as Array<{
    version: string;
  }>;

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error("SERVER_VERSION_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
