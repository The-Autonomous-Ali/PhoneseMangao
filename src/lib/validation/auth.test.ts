import { describe, it, expect } from 'vitest';
import { otpRequestSchema, otpVerifySchema } from './auth';

describe('otpRequestSchema', () => {
  it('accepts a valid E.164 phone number', () => {
    expect(otpRequestSchema.safeParse({ phone: '+919876543210' }).success).toBe(true);
  });

  it('rejects a phone number without a country code', () => {
    expect(otpRequestSchema.safeParse({ phone: '9876543210' }).success).toBe(false);
  });

  it('rejects a non-numeric phone number', () => {
    expect(otpRequestSchema.safeParse({ phone: '+91abc4321cd' }).success).toBe(false);
  });
});

describe('otpVerifySchema', () => {
  it('accepts a valid phone + 6-digit code', () => {
    expect(
      otpVerifySchema.safeParse({ phone: '+919876543210', code: '123456' }).success
    ).toBe(true);
  });

  it('rejects a code that is not 6 digits', () => {
    expect(
      otpVerifySchema.safeParse({ phone: '+919876543210', code: '123' }).success
    ).toBe(false);
  });

  it('rejects a missing phone', () => {
    expect(otpVerifySchema.safeParse({ code: '123456' }).success).toBe(false);
  });
});
