export interface SmsDriver {
  /** Stable identifier, used in logs and tests. */
  readonly name: string;
  /**
   * One method per message type, because each maps to one DLT-registered
   * template. Throws if delivery fails.
   */
  sendOtpSms(to: string, code: string): Promise<void>;
}
