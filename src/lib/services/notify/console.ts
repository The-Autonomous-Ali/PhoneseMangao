import type { NotifyDriver, OwnerAlert } from './types';

/** What runs until the Utility template is approved, and in development. */
export const consoleNotifyDriver: NotifyDriver = {
  name: 'console',

  async sendOwnerAlert(alert: OwnerAlert): Promise<void> {
    console.log(
      `[alert] New order ${alert.orderNumber} — ${alert.customerName} ${alert.customerPhone} — ` +
        `${alert.slot} — ${alert.summary}`
    );
  },
};
