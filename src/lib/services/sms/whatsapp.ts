import { getEnv } from '@/lib/env';
import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import type { SmsDriver } from './types';

/**
 * Delivers OTPs over the WhatsApp Cloud API, direct from Meta — no aggregator.
 *
 * Requires an Authentication-category template. Utility templates are rejected
 * for one-time codes, and only the Authentication format renders the copy-code
 * button, which is why the code is sent twice: once for the message body and
 * once for the button that copies it.
 */
export const whatsappDriver: SmsDriver = {
  name: 'whatsapp',

  async sendOtpSms(to: string, code: string): Promise<void> {
    // Validated at boot by env.ts when SMS_DRIVER is 'whatsapp'. Asserted here
    // so this module reads as total rather than relying on that at a distance.
    const templateName = getEnv().WHATSAPP_AUTH_TEMPLATE_NAME;
    if (!templateName) {
      throw new Error('WhatsApp driver is selected but its credentials are not configured');
    }

    await sendWhatsAppTemplate({
      to,
      templateName,
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    });
  },
};
