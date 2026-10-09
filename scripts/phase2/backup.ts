import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function getPgPassword(): Promise<string> {
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD;

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('PGPASSWORD','User')",
        ],
        { maxBuffer: 1024 * 1024 },
      );
      const v = String(stdout ?? "").trim();
      if (v) return v;
    } catch {
      // ignore and fall through
    }
  }

  throw new Error(
    "PGPASSWORD is not set. Set it in the environment before running backups.",
  );
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function main() {
  const pgPassword = await getPgPassword();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const u = new URL(dbUrl);
  const host = u.hostname;
  const port = u.port || "5432";
  const user = decodeURIComponent(u.username);
  const dbName = u.pathname.replace(/^\//, "");

  if (!host || !user || !dbName) {
    throw new Error("Could not parse DATABASE_URL.");
  }

  mkdirSync("backups", { recursive: true });

  const baseName = `backup_${timestamp()}`;
  const dumpPath = `backups/${baseName}.dump`;
  const listPath = `backups/${baseName}.list.txt`;

  const pgDumpExe = "C:/Program Files/PostgreSQL/18/bin/pg_dump.exe";
  const pgRestoreExe = "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe";

  await execFileAsync(
    pgDumpExe,
    ["-h", host, "-p", port, "-U", user, "-d", dbName, "-Fc", "-f", dumpPath],
    {
      env: {
        ...process.env,
        PGPASSWORD: pgPassword,
      },
    },
  );

  const { stdout } = await execFileAsync(
    pgRestoreExe,
    ["--list", dumpPath],
    {
      env: {
        ...process.env,
        PGPASSWORD: pgPassword,
      },
      maxBuffer: 1024 * 1024 * 50,
    },
  );

  await import("node:fs").then(({ writeFileSync }) => {
    writeFileSync(listPath, stdout, "utf8");
  });

  console.log(
    JSON.stringify(
      {
        dumpPath,
        listPath,
        db: { host, port, user, dbName },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("BACKUP_FAILED");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
