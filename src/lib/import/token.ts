/**
 * Jeton d'aperçu d'import : HMAC-SHA256 signé, à durée limitée, lié à
 * l'utilisateur, au tenant, au type d'import et à l'empreinte de l'aperçu
 * (contenu du fichier + état de référence en base). Sans état serveur :
 * la confirmation re-parse le fichier et recalcule l'empreinte — toute
 * modification concurrente invalide le jeton.
 *
 * Anti-rejeu : les jti consommés sont conservés en mémoire (instance
 * unique PM2). L'écriture reste idempotente par conception (upsert par
 * matricule / assessment+élève).
 */
import crypto from "node:crypto";

const TTL_MS = 15 * 60 * 1000;
const SECRET =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "dev-only-secret";

export type ImportKind = "students" | "grades";

interface PreviewTokenPayload {
  v: 1;
  uid: string;
  sid: string;
  kind: ImportKind;
  /** SHA-256 de l'aperçu canonique (lignes normalisées + état BDD). */
  ph: string;
  jti: string;
  exp: number;
}

const usedJti = new Map<string, number>();

function prune() {
  const now = Date.now();
  for (const [jti, exp] of usedJti) if (exp < now) usedJti.delete(jti);
}

const b64u = (b: Buffer | string) =>
  Buffer.from(b).toString("base64url");

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Sérialisation canonique (clés triées) pour une empreinte stable. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export function signPreviewToken(opts: {
  userId: string;
  schoolId: string;
  kind: ImportKind;
  previewHash: string;
}): { token: string; expiresAt: string } {
  const payload: PreviewTokenPayload = {
    v: 1,
    uid: opts.userId,
    sid: opts.schoolId,
    kind: opts.kind,
    ph: opts.previewHash,
    jti: crypto.randomUUID(),
    exp: Date.now() + TTL_MS,
  };
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return {
    token: `${body}.${sig}`,
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

export type TokenCheck =
  | { ok: true; previewHash: string; jti: string; exp: number }
  | { ok: false; error: "INVALID" | "EXPIRED" | "USED" };

export function verifyPreviewToken(
  token: string,
  ctx: { userId: string; schoolId: string; kind: ImportKind },
): TokenCheck {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, error: "INVALID" };
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "INVALID" };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "INVALID" };
  }

  if (
    payload.v !== 1 ||
    payload.uid !== ctx.userId ||
    payload.sid !== ctx.schoolId ||
    payload.kind !== ctx.kind ||
    typeof payload.ph !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, error: "INVALID" };
  }
  if (payload.exp < Date.now()) return { ok: false, error: "EXPIRED" };
  prune();
  if (usedJti.has(payload.jti)) return { ok: false, error: "USED" };
  return { ok: true, previewHash: payload.ph, jti: payload.jti, exp: payload.exp };
}

/** Marque le jeton comme consommé (à n'appeler qu'au succès du commit). */
export function consumePreviewToken(jti: string, exp: number) {
  prune();
  usedJti.set(jti, exp);
}
