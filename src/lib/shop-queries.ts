import { db } from '@/lib/db';
import { withReadRetry } from '@/lib/db-retry';

/**
 * What the storefront is allowed to show.
 *
 * A product is visible only if it is switched on *and* its category is. The
 * category flag is the shop owner's way of closing a whole aisle — hiding
 * "Fruits" for the season — without touching a single product row, so every
 * storefront query has to honour both. Missing it here would leave a hidden
 * aisle reachable by direct URL.
 */
const VISIBLE = { isActive: true, category: { isActive: true } } as const;

export interface ShopVariant {
  id: string;
  label: string;
  /** Decimal serialised as a string; React cannot pass Decimal to a client component. */
  price: string;
  mrp: string | null;
  isAvailable: boolean;
}

export interface ShopProduct {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  categoryName: string;
  categorySlug: string;
  variants: ShopVariant[];
}

export interface ShopProductDetail extends ShopProduct {
  description: string | null;
}

export interface ShopCategory {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  productCount: number;
}

const variantSelect = {
  orderBy: { price: 'asc' },
  select: { id: true, label: true, price: true, mrp: true, isAvailable: true },
} as const;

function toShopVariant(variant: {
  id: string;
  label: string;
  price: { toFixed(dp: number): string };
  mrp: { toFixed(dp: number): string } | null;
  isAvailable: boolean;
}): ShopVariant {
  return {
    id: variant.id,
    label: variant.label,
    price: variant.price.toFixed(2),
    mrp: variant.mrp?.toFixed(2) ?? null,
    isAvailable: variant.isAvailable,
  };
}

export async function getActiveCategories(): Promise<ShopCategory[]> {
  const categories = await withReadRetry(() =>
    db.category.findMany({
      where: { isActive: true },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
  );

  // An empty aisle is a dead end, so it is not offered at all.
  return categories
    .filter((category) => category._count.products > 0)
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      imageUrl: category.imageUrl,
      productCount: category._count.products,
    }));
}

export async function getStorefrontProducts(
  options: { categorySlug?: string; query?: string; take?: number } = {}
): Promise<ShopProduct[]> {
  const query = options.query?.trim();

  const products = await withReadRetry(() =>
    db.product.findMany({
      where: {
        ...VISIBLE,
        ...(options.categorySlug ? { category: { isActive: true, slug: options.categorySlug } } : {}),
        // Name only, case-insensitive. Deliberately not a full-text index: the
        // catalogue is a few hundred rows a shopkeeper types himself, and
        // somebody searching "tomato" wants the tomatoes, not every description
        // that mentions them.
        ...(query ? { name: { contains: query, mode: 'insensitive' as const } } : {}),
      },
      include: { category: true, variants: variantSelect },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: options.take,
    })
  );

  // A product whose every size is sold out is still worth showing — it tells a
  // regular the shop stocks it — but it must not outrank things they can buy.
  return products
    .map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: product.imageUrl,
      categoryName: product.category.name,
      categorySlug: product.category.slug,
      variants: product.variants.map(toShopVariant),
    }))
    .sort((a, b) => Number(hasStock(b)) - Number(hasStock(a)));
}

export function hasStock(product: ShopProduct): boolean {
  return product.variants.some((variant) => variant.isAvailable);
}

export async function getProductBySlug(slug: string): Promise<ShopProductDetail | null> {
  const product = await withReadRetry(() =>
    db.product.findFirst({
      where: { slug, ...VISIBLE },
      include: { category: true, variants: variantSelect },
    })
  );

  if (!product) return null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    categoryName: product.category.name,
    categorySlug: product.category.slug,
    variants: product.variants.map(toShopVariant),
  };
}

export async function getCategoryBySlug(slug: string): Promise<ShopCategory | null> {
  const category = await withReadRetry(() =>
    db.category.findFirst({
      where: { slug, isActive: true },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
    })
  );

  if (!category) return null;

  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    imageUrl: category.imageUrl,
    productCount: category._count.products,
  };
}
