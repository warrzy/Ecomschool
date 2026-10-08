import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      schoolId: string;
    };
  }

  interface User {
    id: string;
    schoolId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    schoolId: string;
  }
}
