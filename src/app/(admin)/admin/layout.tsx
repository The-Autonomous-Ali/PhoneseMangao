import Link from 'next/link';
import { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Catalog' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/slots', label: 'Slots' },
  { href: '/admin/pincodes', label: 'Pincodes' },
  { href: '/admin/settings', label: 'Settings' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-card p-4">
        <div className="mb-6 text-lg font-semibold">Admin</div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded px-3 py-2 text-sm hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
