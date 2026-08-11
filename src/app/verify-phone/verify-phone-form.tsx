'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Step = 'phone' | 'code';

/**
 * The escape hatch for a failed send. WhatsApp is a third party on a free-tier
 * account: when it is down, or the number is outside the 250-recipient window,
 * the customer must still be able to place an order.
 */
function CallTheShop({ number }: { number?: string }) {
  if (!number) return <p className="text-sm text-destructive">Please contact the shop to continue.</p>;
  return (
    <p className="text-sm text-destructive">
      We could not send the code. Call the shop on{' '}
      <a href={`tel:${number}`} className="font-medium underline">
        {number}
      </a>{' '}
      and we will confirm your number for you.
    </p>
  );
}

export function VerifyPhoneForm({ shopNumber }: { shopNumber?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSendFailed(false);
    setLoading(true);
    const res = await fetch('/api/auth/phone/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    if (!res.ok) {
      // 502 means the code was generated but WhatsApp would not take it. That
      // is the one failure the customer cannot fix by retrying.
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
    const res = await fetch('/api/auth/phone/verify', {
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
          <CardTitle>
            {step === 'phone' ? 'Confirm your number' : 'Enter the code'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'phone' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                We send your delivery updates on WhatsApp, and the driver may need to call you.
              </p>
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
              {error && <p className="text-sm text-destructive">{error}</p>}
              {sendFailed && <CallTheShop number={shopNumber} />}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send code on WhatsApp'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sent to {phone} on WhatsApp.
              </p>
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
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                  setError(null);
                }}
              >
                Use a different number
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
