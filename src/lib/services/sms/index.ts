import { getEnv } from '@/lib/env';
import { consoleDriver } from './console';
import { whatsappDriver } from './whatsapp';
import type { SmsDriver } from './types';

export type { SmsDriver } from './types';

export function getSmsDriver(): SmsDriver {
  const env = getEnv();

  switch (env.SMS_DRIVER) {
    case 'console':
      if (env.NODE_ENV === 'production') {
        console.warn(
          '[sms] console driver is active in production: no real SMS is being sent, ' +
            'so customers cannot receive a login code.'
        );
      }
      return consoleDriver;
    case 'whatsapp':
      return whatsappDriver;
  }
}

export async function sendOtpSms(to: string, code: string): Promise<void> {
  return getSmsDriver().sendOtpSms(to, code);
}
