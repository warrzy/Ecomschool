import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";

export type CookieJar = Record<string, string>;

export function addSetCookies(jar: CookieJar, setCookies: string[]) {
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

export function cookieHeader(jar: CookieJar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function httpRequest(
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

    req.setTimeout(60_000, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function getCsrf(baseUrl: string, jar: CookieJar) {
  const r = await httpRequest(`${baseUrl}/api/auth/csrf`, { method: "GET" }, jar);
  if (r.status !== 200) {
    throw new Error(`CSRF request failed status=${r.status} body=${r.body}`);
  }
  const data = JSON.parse(r.body) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("Missing csrfToken");
  return data.csrfToken;
}

export async function signIn(input: {
  baseUrl: string;
  email: string;
  password: string;
}): Promise<{ jar: CookieJar; callbackBody: string; status: number }> {
  const jar: CookieJar = {};
  const csrfToken = await getCsrf(input.baseUrl, jar);

  const form = new URLSearchParams();
  form.set("csrfToken", csrfToken);
  form.set("email", input.email);
  form.set("password", input.password);
  form.set("callbackUrl", "/");
  form.set("json", "true");

  const cb = await httpRequest(
    `${input.baseUrl}/api/auth/callback/credentials`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    jar,
  );

  return { jar, callbackBody: cb.body, status: cb.status };
}

export async function canConnect(baseUrl: string) {
  try {
    const jar: CookieJar = {};
    const r = await httpRequest(`${baseUrl}/api/auth/csrf`, { method: "GET" }, jar);
    return r.status === 200;
  } catch {
    return false;
  }
}

export async function ensureDevServer(
  port: number,
): Promise<{ child: ChildProcess | null; baseUrl: string }> {
  const baseUrl = `http://localhost:${port}`;
  const alreadyRunning = await canConnect(baseUrl);

  const child = alreadyRunning
    ? null
    : spawn(
        process.execPath,
        ["node_modules/next/dist/bin/next", "dev", "-p", String(port)],
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

  return { child, baseUrl };
}

export async function killDevServer(child: ChildProcess | null) {
  if (!child) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const tk = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore" },
      );
      tk.on("exit", () => resolve());
      tk.on("error", () => resolve());
    });
    return;
  }
  child.kill();
}

export function resolveTestPort() {
  const authUrl =
    process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  const inferredPort = (() => {
    try {
      const u = new URL(authUrl);
      return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    } catch {
      return 3000;
    }
  })();

  return Number(process.env.LOGIN_TEST_PORT ?? String(inferredPort));
}

export function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`ASSERTION_FAILED: ${message}`);
}

/**
 * Cible de redirection d'une réponse : header `location` (307 classique) ou
 * marqueur RSC `NEXT_REDIRECT;replace;/path;307` (Next 16 + PPR diffuse la
 * redirection dans le flux quand la page est partiellement pré-rendue).
 */
export function redirectTarget(r: {
  headers: IncomingHttpHeaders;
  body: string;
}) {
  const loc = r.headers.location;
  if (typeof loc === "string" && loc) return loc;
  const m = r.body.match(/NEXT_REDIRECT;(?:replace|push);([^;\\]+)/);
  return m?.[1];
}
