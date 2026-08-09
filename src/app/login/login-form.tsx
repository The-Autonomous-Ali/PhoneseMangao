'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Step = 'phone' | 'code';

/** Google's wordmark colours, inlined so the button needs no network request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * The escape hatch for a failed send. WhatsApp is a third party on a free-tier
 * account: when it is down, or the number is outside the 250-recipient window,
 * the customer must still have a way to reach the shop.
 */
function CallTheShop({ number }: { number?: string }) {
  if (!number) return <p className="text-sm text-red-600">Please contact the shop to continue.</p>;
  return (
    <p className="text-sm text-red-600">
      We could not send the code. Call the shop on{' '}
      <a href={`tel:${number}`} className="font-medium underline">
        {number}
      </a>{' '}
      and we will take your order over the phone.
    </p>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  oauth: 'Google sign-in did not complete. Please try again.',
  unverified:
    'That Google account has an unverified email address. Verify it with Google, or log in with your phone number instead.',
};

export function LoginForm({
  oauthError,
  shopNumber,
}: {
  oauthError?: string;
  shopNumber?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.oauth) : null
  );
  const [sendFailed, setSendFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSendFailed(false);
    setLoading(true);
    const res = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    if (!res.ok) {
      // 502 means the code exists but WhatsApp would not take it. Retrying is
      // not the customer's fix, so they get the shop's number instead.
      if (res.status === 502) {
        setSendFailed(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Something went wrong, try again');
      return;
    }
    setStep('code');
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Something went wrong, try again');
      return;
    }
    const data = await res.json();
    router.push(data.role === 'ADMIN' ? '/admin' : '/');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{step === 'phone' ? 'Log in' : 'Enter the code'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'phone' && (
            <>
              {/* An anchor, not a fetch: /api/auth/google/start answers with a
                  redirect to Google, and the browser has to follow that as a
                  top-level navigation for the consent screen to appear. */}
              <a
                href="/api/auth/google/start"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full gap-2')}
              >
                <GoogleMark />
                Continue with Google
              </a>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {step === 'phone' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+919876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {sendFailed && <CallTheShop number={shopNumber} />}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
