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
        <p className="text-sm text-red-600" role="alert">
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
 * Blocks the storefront until a serviceable PIN code is entered.
 *
 * A deliberate choice over checking at checkout: nobody fills a basket only to
 * be told at the end that the shop cannot reach them. The cost is that a search
 * crawler rendering JavaScript sees this panel rather than the catalog. The
 * pages underneath are still fully server-rendered, so the content is in the
 * HTML — softening this to a dismissible banner is a change to this component
 * alone.
 */
export function PincodeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredPincode | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const existing = read();
    setStored(existing);
    setOpen(!existing);
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
          <div className="w-full max-w-sm rounded-xl bg-background p-6 shadow-lg">
            <h2 id="gate-title" className="text-lg font-semibold">
              Where are we delivering?
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              {SHOP_NAME} delivers to selected PIN codes. Enter yours to see what we have today.
            </p>
            <GateForm onConfirmed={confirm} />
            {stored && (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setOpen(false)}
              >
                Keep {stored.pincode}
              </Button>
            )}
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
