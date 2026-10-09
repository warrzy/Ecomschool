import { z } from "zod";

export const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
