import "dotenv/config";
import {
  ensureDevServer,
  httpRequest,
  killDevServer,
  redirectTarget,
  resolveTestPort,
  signIn,
} from "./lib/test-utils";

async function signInAndAssertRootRedirect(args: {
  baseUrl: string;
  email: string;
  password: string;
  expectedLocationPrefix: string;
}) {
  const { jar, status } = await signIn({
    baseUrl: args.baseUrl,
    email: args.email,
    password: args.password,
  });
  if (status >= 400) {
    throw new Error(`Sign-in failed for ${args.email} status=${status}`);
  }

  const rootRes = await httpRequest(`${args.baseUrl}/`, { method: "GET" }, jar);
  const loc = redirectTarget(rootRes) ?? null;
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

  const port = resolveTestPort();
  const { child, baseUrl } = await ensureDevServer(port);

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
    await killDevServer(child);
  }
}

main().catch((e) => {
  console.error("LOGIN_TEST_FAILED");
  console.error(e);
  process.exit(1);
});
