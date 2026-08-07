import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS: Array<{ key: string; value: Prisma.InputJsonValue }> = [
  { key: 'delivery_fee', value: 30 },
  { key: 'min_order_value', value: 199 },
  { key: 'whatsapp_number', value: '+910000000000' },
  { key: 'shop_open', value: true },
];

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
