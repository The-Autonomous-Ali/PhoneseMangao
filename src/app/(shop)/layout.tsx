import type { ReactNode } from 'react';
import Link from 'next/link';
import { CartProvider } from '@/components/shop/cart-provider';
import { PincodeProvider } from '@/components/shop/pincode-provider';
import { SiteHeader } from '@/components/shop/site-header';
import { CallToOrderButton } from '@/components/shop/call-to-order-button';
import { SHOP_NAME } from '@/lib/constants';

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <PincodeProvider>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t py-6">
            <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 text-sm text-muted-foreground">
              <span>
                © {new Date().getFullYear()} {SHOP_NAME}
              </span>
              <Link href="/login" className="w-fit hover:text-foreground hover:underline">
                Log in
              </Link>
            </div>
          </footer>
        </div>
        <CallToOrderButton phoneNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER} />
      </PincodeProvider>
    </CartProvider>
  );
}
