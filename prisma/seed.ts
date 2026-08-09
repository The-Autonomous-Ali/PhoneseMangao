import { PrismaClient, Prisma, UnitType } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS: Array<{ key: string; value: Prisma.InputJsonValue }> = [
  { key: 'delivery_fee', value: 30 },
  { key: 'min_order_value', value: 199 },
  { key: 'whatsapp_number', value: '+910000000000' },
  { key: 'shop_open', value: true },
];

/**
 * A small sample catalog, so there is something to look at while the storefront
 * is built in Phase 3 and something to click while the admin screens are worked
 * on. Keyed by slug and upserted, so re-running the seed never duplicates rows
 * and never overwrites prices the shop owner has since edited.
 */
const SAMPLE_CATALOG = [
  {
    slug: 'vegetables',
    name: 'Vegetables',
    sortOrder: 0,
    products: [
      {
        slug: 'tomatoes',
        name: 'Tomatoes',
        description: 'Local, vine-ripened.',
        variants: [
          { label: '500 g', unitType: UnitType.GRAM, unitValue: '500', price: '25', mrp: '30' },
          { label: '1 kg', unitType: UnitType.KG, unitValue: '1', price: '45', mrp: '55' },
        ],
      },
      {
        slug: 'onions',
        name: 'Onions',
        description: null,
        variants: [
          { label: '1 kg', unitType: UnitType.KG, unitValue: '1', price: '35', mrp: '40' },
          { label: '5 kg', unitType: UnitType.KG, unitValue: '5', price: '160', mrp: null },
        ],
      },
      {
        slug: 'coriander',
        name: 'Coriander',
        description: null,
        variants: [
          { label: '1 bunch', unitType: UnitType.BUNDLE, unitValue: '1', price: '10', mrp: null },
        ],
      },
    ],
  },
  {
    slug: 'fruits',
    name: 'Fruits',
    sortOrder: 1,
    products: [
      {
        slug: 'bananas',
        name: 'Bananas',
        description: null,
        variants: [
          { label: '1 dozen', unitType: UnitType.PIECE, unitValue: '12', price: '60', mrp: '70' },
        ],
      },
    ],
  },
  {
    slug: 'staples',
    name: 'Staples',
    sortOrder: 2,
    products: [
      {
        slug: 'basmati-rice',
        name: 'Basmati Rice',
        description: 'Aged long-grain.',
        variants: [
          { label: '1 kg', unitType: UnitType.KG, unitValue: '1', price: '120', mrp: '140' },
          { label: '5 kg', unitType: UnitType.KG, unitValue: '5', price: '560', mrp: '650' },
        ],
      },
    ],
  },
];

/**
 * Delivery area. Without at least one row the storefront's PIN code gate locks
 * everybody out, including the developer, so this is not optional sample data.
 * The shop owner replaces these from the admin before launch.
 */
const SAMPLE_PINCODES = [
  { pincode: '400069', area: 'Andheri East' },
  { pincode: '400053', area: 'Andheri West' },
  { pincode: '400058', area: 'Versova' },
];

async function seedPincodes(): Promise<void> {
  for (const entry of SAMPLE_PINCODES) {
    await prisma.servicePincode.upsert({
      where: { pincode: entry.pincode },
      update: {},
      create: entry,
    });
  }
  console.log(`Seeded ${SAMPLE_PINCODES.length} serviceable pincodes`);
}

async function seedCatalog(): Promise<void> {
  let productCount = 0;

  for (const category of SAMPLE_CATALOG) {
    const categoryRow = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { slug: category.slug, name: category.name, sortOrder: category.sortOrder },
    });

    for (const product of category.products) {
      const productRow = await prisma.product.upsert({
        where: { slug: product.slug },
        update: {},
        create: {
          slug: product.slug,
          name: product.name,
          description: product.description,
          categoryId: categoryRow.id,
        },
      });
      productCount++;

      // Variants have no natural unique key, so a plain upsert is not
      // available. Seeding them only for a product that has none keeps the
      // whole script idempotent without clobbering edited prices.
      const existing = await prisma.variant.count({ where: { productId: productRow.id } });
      if (existing === 0) {
        await prisma.variant.createMany({
          data: product.variants.map((variant) => ({ ...variant, productId: productRow.id })),
        });
      }
    }
  }

  console.log(`Seeded ${SAMPLE_CATALOG.length} categories and ${productCount} products`);
}

async function main() {
  // TODO: replace with the real admin phone number before go-live
  const admin = await prisma.user.upsert({
    where: { phone: '+911234567890' },
    update: { role: 'ADMIN' },
    create: { phone: '+911234567890', role: 'ADMIN', name: 'Shop Owner' },
  });
  console.log(`Seeded admin user: ${admin.phone}`);

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: { key: setting.key, value: setting.value },
    });
  }
  console.log(`Seeded ${DEFAULT_SETTINGS.length} settings`);

  await seedPincodes();
  await seedCatalog();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
