import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { whatsappDriver } from './whatsapp';
import { resetEnvCache } from '@/lib/env';

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

/** The single fetch call the driver made, decoded. */
async function captureRequest(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) };
}

describe('whatsappDriver', () => {
  it('posts to the Cloud API endpoint for the configured phone number id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    await whatsappDriver.sendOtpSms('+919876543210', '123456');

    const { url, init } = await captureRequest(fetchMock);
    expect(url).toBe('https://graph.facebook.com/v21.0/555000111/messages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer system-user-token'
    );
  });

  it('sends the number as digits only, because the Cloud API rejects a leading +', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    await whatsappDriver.sendOtpSms('+91 98765-43210', '123456');

    const { body } = await captureRequest(fetchMock);
    expect(body.to).toBe('919876543210');
  });

  it('sends the configured authentication template with the code in both slots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    await whatsappDriver.sendOtpSms('+919876543210', '654321');

    const { body } = await captureRequest(fetchMock);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('shop_login_code');

    // An Authentication-category template renders a copy-code button, and Meta
    // requires the same code in the button parameter as in the body.
    const [bodyComponent, buttonComponent] = body.template.components;
    expect(bodyComponent.parameters[0].text).toBe('654321');
    expect(buttonComponent.sub_type).toBe('url');
    expect(buttonComponent.parameters[0].text).toBe('654321');
  });

  it('throws with the status when the Cloud API rejects the send', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"message":"bad template"}}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(whatsappDriver.sendOtpSms('+919876543210', '123456')).rejects.toThrow(/400/);
  });

  it('never puts the access token or the code in the thrown error', async () => {
    // This error is logged, and logs are read by more people than hold the
    // credentials. The OTP is a live credential for the next five minutes.
    const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(whatsappDriver.sendOtpSms('+919876543210', '123456')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('system-user-token'),
      })
    );
    await expect(whatsappDriver.sendOtpSms('+919876543210', '123456')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('123456'),
      })
    );
  });

  it('throws when the network call itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(whatsappDriver.sendOtpSms('+919876543210', '123456')).rejects.toThrow();
  });
});
