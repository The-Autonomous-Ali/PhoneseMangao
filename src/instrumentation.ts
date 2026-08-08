export async function register() {
  // Node runtime only. The Edge runtime gets a different, smaller env surface
  // and does not need the database or SMS configuration.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('@/lib/env');
    getEnv();
  }
}
