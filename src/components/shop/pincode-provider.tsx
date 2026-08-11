'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SHOP_NAME, PINCODE_STORAGE_KEY } from '@/lib/constants';
import { isValidPincode } from '@/lib/serviceability';

interface StoredPincode {
  pincode: string;
  area?: string;
}

interface PincodeContextValue {
  pincode: string | null;
  area?: string;
  hydrated: boolean;
  /** Reopens the gate so the customer can change a delivery location. */
  change: () => void;
}

const PincodeContext = createContext<PincodeContextValue | null>(null);

function read(): StoredPincode | null {
  try {
    const raw = window.localStorage.getItem(PINCODE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidPincode(parsed?.pincode ?? '') ? parsed : null;
  } catch {
    return null;
  }
}

function GateForm({ onConfirmed }: { onConfirmed: (value: StoredPincode) => void }) {
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/serviceability?pincode=${encodeURIComponent(pincode)}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? 'Enter a valid 6-digit PIN code');
        return;
      }
      if (!data.serviceable) {
        setError(`Sorry, we do not deliver to ${pincode} yet.`);
        return;
      }
      onConfirmed({ pincode, area: data.area });
    } catch {
      // The gate blocks the whole site, so a network blip must not trap
      // someone behind it with no explanation.
      setError('Could not check that right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gate-pincode">Delivery PIN code</Label>
        <Input
          id="gate-pincode"
          name="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="400069"
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={loading || pincode.length < 6}>
        {loading ? 'Checking...' : 'Start shopping'}
      </Button>
    </form>
  );
}

/**
 * Remembers where the customer wants delivery. Asks, but does not insist.
 *
 * This used to block the storefront until a serviceable PIN code was entered,
 * on the reasoning that nobody should fill a basket only to be told at the end
 * that the shop cannot reach them. That reasoning is sound and the trade was
 * still wrong: it put a form in front of the shop window. A stranger who has
 * never heard of the place was asked for their address before being shown a
 * single tomato, and a crawler rendering JavaScript saw the panel instead of
 * the catalogue.
 *
 * So it now opens only when asked — from the header, or from the cart. Nothing
 * is lost in correctness, because the PIN code was never what enforced
 * serviceability: saving an address checks it, and `POST /api/orders` checks it
 * again at the moment of ordering. This is a convenience, and it is now
 * treated as one.
 */
export function PincodeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredPincode | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Deliberately not `setOpen(!existing)`. Arriving with no PIN code stored
    // is the normal state of a first-time visitor, not a problem to solve
    // before they are allowed to look.
    setStored(read());
    setHydrated(true);
  }, []);

  const confirm = useCallback((value: StoredPincode) => {
    try {
      window.localStorage.setItem(PINCODE_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Private browsing throws. They can still shop; they will be asked again.
    }
    setStored(value);
    setOpen(false);
  }, []);

  const change = useCallback(() => setOpen(true), []);

  return (
    <PincodeContext.Provider
      value={{ pincode: stored?.pincode ?? null, area: stored?.area, hydrated, change }}
    >
      {children}

      {/* Rendered only after hydration. Showing it during SSR would flash the
          gate at someone who already has a PIN code stored. */}
      {hydrated && open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gate-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg">
            <h2 id="gate-title" className="text-xl">
              Where are we delivering?
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              {SHOP_NAME} delivers to selected areas. Check yours, and we will remember it.
            </p>
            <GateForm onConfirmed={confirm} />
            {/* Always dismissible. The panel is a convenience now, and a
                convenience with no way out is just a gate with better copy. */}
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => setOpen(false)}
            >
              {stored ? `Keep ${stored.pincode}` : 'Not now, I am just looking'}
            </Button>
          </div>
        </div>
      )}
    </PincodeContext.Provider>
  );
}

export function usePincode(): PincodeContextValue {
  const context = useContext(PincodeContext);
  if (!context) throw new Error('usePincode must be used inside a PincodeProvider');
  return context;
}
