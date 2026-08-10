import { getEnv } from '@/lib/env';
import { getShopSettings } from '@/lib/settings';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const settings = await getShopSettings();

  // Drives the explanatory text only. The refusal that matters is in
  // setPaymentsEnabled — a disabled input is not a control.
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} razorpayConfigured={Boolean(getEnv().RAZORPAY_KEY_ID)} />
    </div>
  );
}
