import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { sendWhatsAppTemplate } from './whatsapp-transport';

const ORIGINAL = { ...process.env };

const CONFIGURED = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  APP_URL: 'https://shop.example.in',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  CRON_SECRET: 'y'.repeat(16),
  IMAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'shopcloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'cloudinary-secret',
  SMS_DRIVER: 'whatsapp',
  WHATSAPP_PHONE_NUMBER_ID: '555000111',
  WHATSAPP_ACCESS_TOKEN: 'system-user-token',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'shop_login_code',
};

function ok(): Response {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
}

beforeEach(() => {
  process.env = { ...ORIGINAL, ...CONFIGURED } as NodeJS.ProcessEnv;
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL } as NodeJS.ProcessEnv;
  resetEnvCache();
  vi.restoreAllMocks();
});

describe('sendWhatsAppTemplate', () => {
  it('posts to the pinned graph version and phone number id', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '+91 98765-43210', templateName: 't', components: [] });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://graph.facebook.com/v21.0/555000111/messages');
  });

  it('strips everything but digits from the recipient', async () => {
    // The Cloud API rejects a leading '+', and customers type spaces and dashes
    // that E.164 validation lets through in other shapes.
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '+91 98765-43210', templateName: 't', components: [] });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).to).toBe('919876543210');
  });

  it('sends the template name and components it was given', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'KD-1042' }] }];

    await sendWhatsAppTemplate({ to: '919876543210', templateName: 'shop_alert', components });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.template.name).toBe('shop_alert');
    expect(body.template.components).toEqual(components);
    expect(body.messaging_product).toBe('whatsapp');
  });

  it('sends the access token as a bearer credential', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer system-user-token');
  });

  it('wraps a transport failure, since fetch only rejects when unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      })
    );

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow('could not reach the Cloud API');
  });

  it('reports the status without echoing the response body', async () => {
    // Meta's error body quotes the request back, which would put the access
    // token and any template parameter into the server log.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Bearer sensitive' } }), { status: 401 })
      )
    );

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow(/status 401/);

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.not.toThrow(/sensitive/);
  });

  it('throws when credentials are missing rather than posting without them', async () => {
    // SMS_DRIVER is set to console here on purpose. With it set to 'whatsapp',
    // env.ts rejects a blank access token at parse time and this guard is
    // never reached — which is the better failure and is already tested there.
    // What this covers is the transport being called on a shop that has not
    // selected WhatsApp at all, where env validation has nothing to say.
    process.env = {
      ...ORIGINAL,
      ...CONFIGURED,
      SMS_DRIVER: 'console',
      WHATSAPP_ACCESS_TOKEN: '',
    } as NodeJS.ProcessEnv;
    resetEnvCache();
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendWhatsAppTemplate({ to: '919876543210', templateName: 't', components: [] })
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
