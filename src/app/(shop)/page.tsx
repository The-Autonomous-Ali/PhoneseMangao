import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getActiveCategories, getStorefrontProducts } from '@/lib/shop-queries';
import { getShopSettings, type ShopSettings } from '@/lib/settings';
import { ProductCard } from '@/components/shop/product-card';
import { formatRupees } from '@/lib/format';
import { SHOP_NAME, SHOP_TAGLINE } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${SHOP_NAME} — fresh groceries delivered`,
  description: SHOP_TAGLINE,
};

const FEATURED_COUNT = 8;

/**
 * The four promises at the foot of the home page.
 *
 * Every one of them is something the shop actually does, and the two money
 * figures come from settings rather than being written into the copy. A claim
 * on a home page that quietly stops being true — because the owner raised the
 * free-delivery threshold in the admin and nobody remembered this paragraph —
 * is worse than making no claim at all.
 */
function TrustBand({ settings }: { settings: ShopSettings }) {
  const promises = [
    {
      k: 'Three slots daily',
      v: 'Morning, afternoon or evening. You pick the window; we work around it.',
    },
    {
      k: 'Weighed at your door',
      v: 'Loose produce is settled on what is actually delivered, so you never pay for weight you did not get.',
    },
    {
      k: 'Cash or online',
      v: 'Pay the driver or pay on your phone. Cash orders are confirmed by a code sent to your number.',
    },
    {
      k: `Free over ${formatRupees(settings.freeDeliveryAbove)}`,
      v: `Delivery is ${formatRupees(settings.deliveryFee)} below that. Minimum order ${formatRupees(settings.minOrderValue)}.`,
    },
  ];

  return (
    <section className="pb-12">
      <div className="grid gap-6 rounded-[22px] bg-[#152a20] px-8 py-9 sm:grid-cols-2 lg:grid-cols-4">
        {promises.map((promise) => (
          <div key={promise.k}>
            <div className="font-heading text-[26px] text-[#d4b15e]">{promise.k}</div>
            <p className="mt-2 text-sm leading-relaxed text-[#efe7d3]">{promise.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A small caps-and-rule heading, used above each band on the page. */
function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h2 className="text-[26px]">{children}</h2>
        <div className="mt-2 h-px w-14 bg-gold" />
      </div>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

export default async function HomePage() {
  const [categories, products, settings] = await Promise.all([
    getActiveCategories(),
    getStorefrontProducts({ take: FEATURED_COUNT }),
    getShopSettings(),
  ]);

  const whatsapp = settings.whatsappNumber.replace(/\D/g, '');

  if (categories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <h1 className="text-2xl">We are setting up</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The shop is not stocked yet. Please check back shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-om-fade">
      <section className="animate-om-up grid items-center gap-10 pt-6 pb-4 md:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#20392d] px-4 py-1.5 text-[12.5px] font-semibold tracking-[0.04em] text-gold uppercase">
            Morning · Afternoon · Evening delivery
          </div>

          <h1 className="mt-4.5 text-[clamp(46px,6.2vw,82px)] leading-[0.97] tracking-[-0.01em] text-[#f5edde] [text-shadow:0_2px_44px_rgba(0,0,0,0.55)]">
            Sun-ripened.
            <br />
            Hand-picked.
            <br />
            <span className="text-[#d4b15e]">At your door by tonight.</span>
          </h1>

          <p className="mt-5 mb-7 max-w-[460px] text-lg leading-relaxed text-[#a9b7ac]">
            Fruit still warm from the sun, vegetables pulled at dawn, and every grocery staple —
            chosen by hand and carried to your door in the slot you choose.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="#shop"
              className="rounded-full bg-gold px-7 py-3.5 text-[15.5px] font-semibold tracking-wide text-[#132019] transition-colors hover:bg-gold-hover"
            >
              Start shopping
            </Link>
            {/* Only offered when the shop has actually given a number. A dead
                WhatsApp button is worse than none — it reads as the shop
                ignoring you. */}
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-[#305640] bg-[#182e24] px-6 py-3.5 text-[15px] font-semibold text-foreground transition-colors hover:border-gold"
              >
                Order on WhatsApp
              </a>
            )}
          </div>
        </div>

        <div className="relative hidden aspect-[4/3] overflow-hidden rounded-2xl border border-border md:block">
          {products[0]?.imageUrl ? (
            <Image
              src={products[0].imageUrl}
              alt=""
              fill
              sizes="50vw"
              priority
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-[#182e24] text-center font-heading text-2xl text-muted-foreground">
              {SHOP_NAME}
            </div>
          )}
        </div>
      </section>

      <section id="shop" className="scroll-mt-20 pt-12">
        <SectionHeading hint={`${categories.length} aisles`}>Shop by category</SectionHeading>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-gold/60"
            >
              <div className="relative aspect-[3/2]">
                {category.imageUrl ? (
                  <Image
                    src={category.imageUrl}
                    alt={category.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-muted font-heading text-lg text-muted-foreground">
                    {category.name}
                  </div>
                )}
              </div>
              <div className="px-3.5 py-3">
                <div className="font-semibold group-hover:text-gold">{category.name}</div>
                <div className="text-xs text-muted-foreground">
                  {category.productCount} item{category.productCount === 1 ? '' : 's'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {products.length > 0 && (
        <section className="pt-14 pb-6">
          <SectionHeading hint="picked this morning">Fresh this week</SectionHeading>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      <TrustBand settings={settings} />
    </div>
  );
}
