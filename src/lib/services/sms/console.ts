import type { SmsDriver } from './types';

/**
 * Stub driver: prints the code instead of texting it. This is what lets the
 * whole app be built and demoed before the client supplies SMS credentials.
 */
export const consoleDriver: SmsDriver = {
  name: 'console',
  async sendOtpSms(to: string, code: string): Promise<void> {
    // Format is depended on by the end-to-end verification — do not change it.
    console.log(`[dev otp] ${to}: ${code}`);
  },
};
