import "dotenv/config";
import { spawn } from "node:child_process";

type CookieJar = Record<string, string>;

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

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

async function fetchJson(url: string, opts: RequestInit, jar: CookieJar) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      cookie: cookieHeader(jar),
    },
  });

  const setCookies = (res.headers as HeadersWithSetCookie).getSetCookie?.();
  if (setCookies?.length) addSetCookies(jar, setCookies);

  const data = await res.json();
  return { res, data };
}

async function fetchManual(url: string, opts: RequestInit, jar: CookieJar) {
  const res = await fetch(url, {
    ...opts,
    redirect: "manual",
    headers: {
      ...(opts.headers ?? {}),
      cookie: cookieHeader(jar),
    },
  });

  const setCookies = (res.headers as HeadersWithSetCookie).getSetCookie?.();
  if (setCookies?.length) addSetCookies(jar, setCookies);

  return res;
}

async function signInAndAssertRootRedirect(args: {
  baseUrl: string;
  email: string;
  password: string;
  expectedLocationPrefix: string;
}) {
  const jar: CookieJar = {};

  const csrf = await fetchJson(`${args.baseUrl}/api/auth/csrf`, { method: "GET" }, jar);
  const csrfToken = csrf.data?.csrfToken as string | undefined;
  if (!csrfToken) throw new Error("Missing csrfToken");

  const form = new URLSearchParams();
  form.set("csrfToken", csrfToken);
  form.set("email", args.email);
  form.set("password", args.password);
  form.set("callbackUrl", "/");
  form.set("json", "true");

  await fetchManual(
    `${args.baseUrl}/api/auth/callback/credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    jar,
  );

  const rootRes = await fetchManual(`${args.baseUrl}/`, { method: "GET" }, jar);
  const loc = rootRes.headers.get("location");
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

  const port = Number(process.env.LOGIN_TEST_PORT ?? "3005");
  const baseUrl = `http://localhost:${port}`;

  const child = spawn(
    process.platform === "win32" ? "cmd" : "npm",
    process.platform === "win32"
      ? ["/c", `npx next dev -p ${port}`]
      : ["run", "dev", "--", "-p", String(port)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );

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
    child.kill();
  }
}

main().catch((e) => {
  console.error("LOGIN_TEST_FAILED");
  console.error(e);
  process.exit(1);
});
