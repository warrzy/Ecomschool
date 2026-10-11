import { z } from "zod";

export const feeCategorySchema = z.object({
  code: z.string().trim().min(1).max(32),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export const feeTariffSchema = z.object({
  academicYearId: z.string().min(1),
  categoryId: z.string().min(1),
  levelId: z.string().optional(),
  classroomId: z.string().optional(),
  amount: z.coerce.number().int().min(0),
  mandatory: z.boolean().default(true),
  paymentPlan: z.enum(["SINGLE", "INSTALLMENTS"]).default("SINGLE"),
  installmentCount: z.coerce.number().int().min(1).max(12).default(1),
  conditions: z.string().trim().max(500).optional(),
});

export const generateChargesSchema = z.object({
  academicYearId: z.string().min(1),
  classroomId: z.string().optional(),
});

export const paymentSchema = z.object({
  studentId: z.string().min(1),
  academicYearId: z.string().min(1),
  amount: z.coerce.number().int().min(1),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHECK", "MOBILE_MONEY", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
  observation: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export const discountSchema = z.object({
  studentId: z.string().min(1),
  academicYearId: z.string().min(1),
  type: z.enum([
    "FIXED_AMOUNT",
    "PERCENT",
    "SCHOLARSHIP",
    "EXEMPTION",
    "FAMILY",
    "EXCEPTIONAL",
  ]),
  value: z.coerce.number().int().min(0),
  reason: z.string().trim().min(3).max(300),
});

export const reminderSchema = z.object({
  studentId: z.string().min(1),
  installmentId: z.string().optional(),
  note: z.string().trim().min(3).max(500),
});
