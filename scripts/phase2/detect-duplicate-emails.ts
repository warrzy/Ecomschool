import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

type Row = { email_norm: string; n: number };

async function main() {
  const rows = (await prisma.$queryRaw`
    select lower(trim("email")) as email_norm, count(*)::int as n
    from "User"
    group by lower(trim("email"))
    having count(*) > 1
    order by n desc, email_norm asc;
  `) as Row[];

  console.log(
    JSON.stringify(
      {
        duplicateCount: rows.length,
        duplicates: rows,
      },
      null,
      2,
    ),
  );

  if (rows.length > 0) {
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error("DUPLICATE_EMAILS_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
