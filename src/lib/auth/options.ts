import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import {
  isLocked,
  recordLoginFailure,
  resetLoginFailures,
  throttleKey,
} from "@/lib/auth/ratelimit";

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  schoolId: string | null;
};

// Hash factice : garantit un coût bcrypt constant quand l'utilisateur
// n'existe pas (pas d'oracle temporel user-inconnu vs mauvais mot de passe).
let DUMMY_HASH: string | null = null;
async function dummyCompare(password: string) {
  if (!DUMMY_HASH) DUMMY_HASH = await hashPassword("dummy-password");
  await verifyPassword(password, DUMMY_HASH);
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    // Session bornée à 12 h ; l'état réel (statut, membership) est re-vérifié
    // en base à chaque requête — pas de révocation JWT côté serveur.
    maxAge: 12 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;

        if (!email || !password) return null;

        // Throttle mémoire par email (rafales) — indépendant de l'existence du compte.
        if (!throttleKey(`login:${email}`)) return null;

        const user = await prisma.user.findFirst({
          where: { status: "ACTIVE", email },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!user) {
          await dummyCompare(password);
          return null;
        }

        // Verrouillage persistant (comptes ACTIVE uniquement).
        if (await isLocked(user.id)) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await recordLoginFailure(user.id);
          return null;
        }
        if (user.id) await resetLoginFailures(user.id).catch(() => null);

        // Source de vérité du rattachement : SchoolMembership ACTIVE.
        // `User.schoolId` n'est plus lu ici (bascule Phase 10).
        const membership = await prisma.schoolMembership.findFirst({
          where: { userId: user.id, status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          select: { schoolId: true },
        });
        const schoolId = membership?.schoolId ?? null;
        if (!schoolId) {
          const hasPlatformRole = await prisma.userRole.count({
            where: { userId: user.id, role: { scope: "PLATFORM" } },
          });
          if (hasPlatformRole === 0) return null;
        }

        const authUser: AuthUser = {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(" "),
          schoolId,
        };

        return authUser;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as AuthUser;
        token.userId = u.id;
        token.schoolId = u.schoolId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.schoolId = token.schoolId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
