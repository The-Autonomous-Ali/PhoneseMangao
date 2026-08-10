import { getEnv } from '@/lib/env';

// Pinned rather than tracking "latest". Meta keeps a graph version working for
// about two years and changes template payload shapes between versions, so an
// unpinned URL turns into a silent breakage on their schedule, not ours.
const GRAPH_VERSION = 'v21.0';

/**
 * Posts one template message to the WhatsApp Cloud API.
 *
 * Shared by the OTP driver and the owner-alert driver. They send different
 * template categories — Authentication and Utility, which Meta approves
 * separately — but the transport underneath is identical, and duplicating it
 * would mean duplicating the two rules that matter: that `fetch` only rejects
 * when the host is unreachable, so an unhappy Meta needs its own check; and
 * that the error body is never logged, because it quotes the request back and
 * would put the access token and the message parameters into the log.
 */
export async function sendWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  components: unknown[];
}): Promise<void> {
  const env = getEnv();

  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp is not configured');
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
          // Digits only. The Cloud API rejects a leading '+', and customers type
          // numbers with spaces and dashes that E.164 validation lets through in
          // other shapes.
          to: input.to.replace(/\D/g, ''),
          type: 'template',
          template: {
            name: input.templateName,
            language: { code: 'en' },
            components: input.components,
          },
        }),
      }
    );
  } catch (cause) {
    throw new Error('WhatsApp send failed: could not reach the Cloud API', { cause });
  }

  if (!response.ok) {
    throw new Error(`WhatsApp send failed with status ${response.status}`);
  }
}
