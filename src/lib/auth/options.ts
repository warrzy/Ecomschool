import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  schoolId: string;
};

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
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

        const user = await prisma.user.findFirst({
          where: {
            email,
            status: "ACTIVE",
          },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            schoolId: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        const authUser: AuthUser = {
          id: user.id,
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(" "),
          schoolId: user.schoolId,
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
        token.schoolId = u.schoolId;
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
