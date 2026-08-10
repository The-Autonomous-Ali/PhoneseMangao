import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/services/whatsapp-transport', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import { resetEnvCache } from '@/lib/env';
import { whatsappNotifyDriver } from './whatsapp';
import type { OwnerAlert } from './types';

const ORIGINAL = { ...process.env };

const ALERT: OwnerAlert = {
  orderNumber: 'KD-1042',
  customerName: 'Ramesh',
  customerPhone: '98765 43210',
  slot: 'Tomorrow morning (7–10am)',
  summary: '3 items · COD · collect ₹480',
};

const CONFIGURED = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  WHATSAPP_ALERT_TEMPLATE_NAME: 'shop_new_order',
  WHATSAPP_OWNER_NUMBER: '+919000000000',
};

beforeEach(() => {
  process.env = { ...ORIGINAL, ...CONFIGURED } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.mocked(sendWhatsAppTemplate).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('whatsappNotifyDriver', () => {
  it('sends the five fields as template parameters, in order', async () => {
    await whatsappNotifyDriver.sendOwnerAlert(ALERT);

    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: '+919000000000',
      templateName: 'shop_new_order',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'KD-1042' },
            { type: 'text', text: 'Ramesh' },
            { type: 'text', text: '98765 43210' },
            { type: 'text', text: 'Tomorrow morning (7–10am)' },
            { type: 'text', text: '3 items · COD · collect ₹480' },
          ],
        },
      ],
    });
  });

  it('skips rather than throwing when no owner number is set', async () => {
    // An owner who has not given his own number should not stop orders.
    process.env = { ...ORIGINAL, ...CONFIGURED, WHATSAPP_OWNER_NUMBER: '' } as NodeJS.ProcessEnv;
    resetEnvCache();

    await expect(whatsappNotifyDriver.sendOwnerAlert(ALERT)).resolves.toBeUndefined();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('skips rather than throwing when the template is not approved yet', async () => {
    process.env = {
      ...ORIGINAL,
      ...CONFIGURED,
      WHATSAPP_ALERT_TEMPLATE_NAME: '',
    } as NodeJS.ProcessEnv;
    resetEnvCache();

    await expect(whatsappNotifyDriver.sendOwnerAlert(ALERT)).resolves.toBeUndefined();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
