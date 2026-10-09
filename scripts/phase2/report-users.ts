import "dotenv/config";
import { prisma } from "@/lib/db/prisma";

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      schoolId: true,
      status: true,
      createdAt: true,
      userRoles: {
        select: {
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const roleCounts = new Map<string, number>();

  const reportUsers = users.map((u) => {
    const roles = u.userRoles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
    }));

    for (const r of roles) {
      roleCounts.set(r.name, (roleCounts.get(r.name) ?? 0) + 1);
    }

    return {
      id: u.id,
      email: u.email,
      schoolId: u.schoolId,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      roles,
    };
  });

  const roleSummary = Array.from(roleCounts.entries())
    .map(([roleName, count]) => ({ roleName, count }))
    .sort((a, b) => b.count - a.count || a.roleName.localeCompare(b.roleName));

  const output = {
    generatedAt: new Date().toISOString(),
    userCount: reportUsers.length,
    roleSummary,
    users: reportUsers,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error("REPORT_FAILED");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
