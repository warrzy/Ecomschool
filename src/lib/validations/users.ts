import { z } from "zod";
import { passwordSchema } from "@/lib/auth/password";

export const userCreateSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  roleId: z.string().min(1),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema.optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  roleId: z.string().min(1).optional(),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
