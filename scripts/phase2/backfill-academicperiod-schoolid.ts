import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const updated = await prisma.$executeRaw`
    update "AcademicPeriod" ap
    set "schoolId" = ay."schoolId"
    from "AcademicYear" ay
    where ap."academicYearId" = ay.id
      and (ap."schoolId" is distinct from ay."schoolId");
  `;

  const nullCount = (await prisma.$queryRaw`
    select count(*)::int as n
    from "AcademicPeriod"
    where "schoolId" is null;
  `) as Array<{ n: number }>;

  console.log(
    JSON.stringify(
      {
        updatedRows: Number(updated),
        nullSchoolIdCount: nullCount[0]?.n ?? 0,
      },
      null,
      2,
    ),
  );

  if ((nullCount[0]?.n ?? 0) !== 0) {
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error("BACKFILL_ACADEMICPERIOD_SCHOOLID_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
