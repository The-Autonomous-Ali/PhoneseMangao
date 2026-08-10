import { getEnv } from '@/lib/env';
import { sendWhatsAppTemplate } from '@/lib/services/whatsapp-transport';
import type { NotifyDriver, OwnerAlert } from './types';

/**
 * Sends the owner a new-order alert over WhatsApp.
 *
 * A Utility-category template, which Meta approves separately from the
 * Authentication one the OTP driver uses — Authentication templates are
 * accepted only for one-time codes. The five parameters are positional and must
 * match the approved template exactly; their order is documented in
 * docs/superpowers/specs/2026-08-10-owner-alerts-and-dashboard-design.md.
 *
 * Missing configuration skips the alert instead of throwing. The template has
 * to clear Meta's review before it exists, and the owner may not have given his
 * own number — neither is a reason to make noise on a path that runs
 * immediately after a payment has been captured.
 */
export const whatsappNotifyDriver: NotifyDriver = {
  name: 'whatsapp',

  async sendOwnerAlert(alert: OwnerAlert): Promise<void> {
    const env = getEnv();
    const to = env.WHATSAPP_OWNER_NUMBER;
    const templateName = env.WHATSAPP_ALERT_TEMPLATE_NAME;

    if (!to || !templateName) {
      console.warn(
        '[alert] WhatsApp alerts are not configured ' +
          '(WHATSAPP_OWNER_NUMBER, WHATSAPP_ALERT_TEMPLATE_NAME); skipping.'
      );
      return;
    }

    await sendWhatsAppTemplate({
      to,
      templateName,
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: alert.orderNumber },
            { type: 'text', text: alert.customerName },
            { type: 'text', text: alert.customerPhone },
            { type: 'text', text: alert.slot },
            { type: 'text', text: alert.summary },
          ],
        },
      ],
    });
  },
};
