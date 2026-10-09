import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const updated = await prisma.$executeRaw`
    update "User"
    set "email" = lower(trim("email"))
    where "email" <> lower(trim("email"));
  `;

  console.log(
    JSON.stringify(
      {
        updatedRows: Number(updated),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("NORMALIZE_EMAILS_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
