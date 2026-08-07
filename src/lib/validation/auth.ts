import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be in E.164 format, e.g. +919876543210');

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
