import { getEnv } from '@/lib/env';
import { consoleNotifyDriver } from './console';
import { whatsappNotifyDriver } from './whatsapp';
import type { NotifyDriver, OwnerAlert } from './types';

export type { NotifyDriver, OwnerAlert } from './types';

/**
 * Alerts follow `SMS_DRIVER` rather than having a switch of their own.
 *
 * They travel the same channel as OTPs by the owner's decision, so a second
 * variable would be two names for one choice — and an opportunity for them to
 * disagree, leaving alerts pointed at a channel the shop no longer uses.
 */
export function getNotifyDriver(): NotifyDriver {
  switch (getEnv().SMS_DRIVER) {
    case 'console':
      return consoleNotifyDriver;
    case 'whatsapp':
      return whatsappNotifyDriver;
  }
}

export async function sendOwnerAlert(alert: OwnerAlert): Promise<void> {
  return getNotifyDriver().sendOwnerAlert(alert);
}
