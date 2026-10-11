import { prisma } from "@/lib/db/prisma";

/**
 * Protection force-brute à deux niveaux :
 * 1) Throttle mémoire (par processus) — rejette immédiatement les rafales.
 * 2) Verrouillage persistant (`User.failedLoginCount`/`lockedUntil`) —
 *    survit aux redémarrages et mutualisable en multi-instance.
 */

const WINDOW_MS = 30_000; // fenêtre de throttle
const MAX_BURST = 5; // tentatives par fenêtre
const LOCK_THRESHOLD = 8; // échecs persistés → verrou
const LOCK_MS = 15 * 60 * 1000; // verrou 15 min

const attempts = new Map<string, { count: number; windowStart: number }>();

/** true si la tentative est autorisée côté throttle mémoire. */
export function throttleKey(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return true;
  }
  a.count++;
  return a.count <= MAX_BURST;
}

/** Nettoyage périodique de la map (évite la fuite mémoire). */
export function sweepThrottle() {
  const now = Date.now();
  for (const [k, v] of attempts) {
    if (now - v.windowStart > WINDOW_MS * 10) attempts.delete(k);
  }
}

/** true si le compte est verrouillé en base. */
export async function isLocked(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { lockedUntil: true },
  });
  return !!u?.lockedUntil && u.lockedUntil.getTime() > Date.now();
}

export async function recordLoginFailure(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true },
  });
  if (!u) return;
  const count = u.failedLoginCount + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: count,
      ...(count >= LOCK_THRESHOLD ? { lockedUntil: new Date(Date.now() + LOCK_MS) } : {}),
    },
  });
}

export async function resetLoginFailures(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}
