import "dotenv/config";
import { spawn } from "node:child_process";
import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";

type CookieJar = Record<string, string>;

function addSetCookies(jar: CookieJar, setCookies: string[]) {
  for (const sc of setCookies) {
    const [pair] = sc.split(";", 1);
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    jar[name] = value;
  }
}

function cookieHeader(jar: CookieJar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function canConnect(baseUrl: string) {
  try {
    const jar: CookieJar = {};
    const r = await httpRequest(`${baseUrl}/api/auth/csrf`, { method: "GET" }, jar);
    return r.status === 200;
  } catch {
    return false;
  }
}

async function httpRequest(
  url: string,
  opts: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  },
  jar: CookieJar,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const u = new URL(url);

  return await new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: opts.method,
        headers: {
          ...opts.headers,
          cookie: cookieHeader(jar),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        const setCookies = res.headers["set-cookie"];
        if (Array.isArray(setCookies) && setCookies.length) {
          addSetCookies(jar, setCookies);
        } else if (typeof setCookies === "string" && setCookies) {
          addSetCookies(jar, [setCookies]);
        }

        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getCsrf(baseUrl: string, jar: CookieJar) {
  const r = await httpRequest(`${baseUrl}/api/auth/csrf`, { method: "GET" }, jar);
  if (r.status !== 200) {
    throw new Error(`CSRF request failed status=${r.status} body=${r.body}`);
  }
  const data = JSON.parse(r.body) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("Missing csrfToken");
  return data.csrfToken;
}

async function signInAndAssertRootRedirect(args: {
  baseUrl: string;
  email: string;
  password: string;
  expectedLocationPrefix: string;
}) {
  const jar: CookieJar = {};

  const csrfToken = await getCsrf(args.baseUrl, jar);

  const form = new URLSearchParams();
  form.set("csrfToken", csrfToken);
  form.set("email", args.email);
  form.set("password", args.password);
  form.set("callbackUrl", "/");
  form.set("json", "true");

  const cb = await httpRequest(
    `${args.baseUrl}/api/auth/callback/credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    jar,
  );

  if (cb.status >= 400) {
    throw new Error(`Credentials callback failed status=${cb.status} body=${cb.body}`);
  }

  const rootRes = await httpRequest(`${args.baseUrl}/`, { method: "GET" }, jar);
  const loc = typeof rootRes.headers.location === "string" ? rootRes.headers.location : null;
  if (!loc || !loc.startsWith(args.expectedLocationPrefix)) {
    throw new Error(
      `Unexpected root redirect. expectedPrefix=${args.expectedLocationPrefix} got=${loc ?? "<none>"}`,
    );
  }

  return { email: args.email, redirect: loc };
}

async function main() {
  const seedPassword = process.env.SEED_TEST_PASSWORD;
  if (!seedPassword) {
    throw new Error("SEED_TEST_PASSWORD is not set (required for login-test)");
  }

  const authUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  const inferredPort = (() => {
    try {
      const u = new URL(authUrl);
      return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    } catch {
      return 3000;
    }
  })();

  const port = Number(process.env.LOGIN_TEST_PORT ?? String(inferredPort));
  const baseUrl = `http://localhost:${port}`;

  const alreadyRunning = await canConnect(baseUrl);
  const child = alreadyRunning
    ? null
    : spawn(
        process.platform === "win32" ? "cmd" : "npm",
        process.platform === "win32"
          ? ["/c", `npx next dev -p ${port}`]
          : ["run", "dev", "--", "-p", String(port)],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );

  if (child) {
    let ready = false;
    child.stdout.on("data", (buf) => {
      const s = String(buf);
      if (s.toLowerCase().includes("ready")) ready = true;
      process.stdout.write(s);
    });
    child.stderr.on("data", (buf) => {
      process.stderr.write(String(buf));
    });

    const start = Date.now();
    while (!ready) {
      if (Date.now() - start > 60_000) {
        child.kill();
        throw new Error("Dev server did not become ready in time");
      }
      await sleep(500);
    }
  }

  try {
    const platform = await signInAndAssertRootRedirect({
      baseUrl,
      email: "admin@ecom-school.local",
      password: seedPassword,
      expectedLocationPrefix: "/platform",
    });

    const school = await signInAndAssertRootRedirect({
      baseUrl,
      email: "school-admin@ecom-school.local",
      password: seedPassword,
      expectedLocationPrefix: "/app",
    });

    console.log(JSON.stringify({ ok: true, platform, school }, null, 2));
  } finally {
    child?.kill();
  }
}

main().catch((e) => {
  console.error("LOGIN_TEST_FAILED");
  console.error(e);
  process.exit(1);
});
