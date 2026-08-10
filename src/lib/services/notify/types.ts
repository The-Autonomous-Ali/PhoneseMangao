/**
 * What the owner is told about a new order.
 *
 * Structured rather than a formatted string because the two channels want
 * different things: WhatsApp needs positional template parameters, the console
 * needs a readable line. Handing a driver a finished sentence would force the
 * WhatsApp one to pull apart what it had just been given, and would break the
 * day the wording changed.
 */
export interface OwnerAlert {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  /** Already readable: "Tomorrow morning (7–10am)". */
  slot: string;
  /** "3 items · COD · collect ₹480" */
  summary: string;
}

export interface NotifyDriver {
  name: string;
  sendOwnerAlert(alert: OwnerAlert): Promise<void>;
}
