import { getEnv } from '@/lib/env';
import type { SmsDriver } from './types';

// Pinned rather than tracking "latest". Meta keeps a graph version working for
// about two years and changes template payload shapes between versions, so an
// unpinned URL turns into a silent breakage on their schedule, not ours.
const GRAPH_VERSION = 'v21.0';

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
    const env = getEnv();

    // Validated at boot by env.ts when SMS_DRIVER is 'whatsapp'. Asserted here
    // so this module reads as total rather than relying on that at a distance.
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = env.WHATSAPP_ACCESS_TOKEN;
    const templateName = env.WHATSAPP_AUTH_TEMPLATE_NAME;
    if (!phoneNumberId || !accessToken || !templateName) {
      throw new Error('WhatsApp driver is selected but its credentials are not configured');
    }

    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            // Digits only. The Cloud API rejects a leading '+', and customers
            // type numbers with spaces and dashes that E.164 validation lets
            // through in other shapes.
            to: to.replace(/\D/g, ''),
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'en' },
              components: [
                { type: 'body', parameters: [{ type: 'text', text: code }] },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: code }],
                },
              ],
            },
          }),
        }
      );
    } catch (cause) {
      // fetch only rejects on transport failure. Wrapped so callers see one
      // error type whether Meta was unreachable or unhappy.
      throw new Error('WhatsApp send failed: could not reach the Cloud API', { cause });
    }

    if (!response.ok) {
      // Status only. Meta's error body echoes parts of the request, and this
      // message reaches the server log — neither the access token nor the OTP
      // itself belongs there.
      throw new Error(`WhatsApp send failed with status ${response.status}`);
    }
  },
};
