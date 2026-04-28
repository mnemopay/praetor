export interface PaymentsAdapter {
  reserve: (usd: number) => Promise<{ holdId: string }>;
  settle: (holdId: string, usd: number) => Promise<void>;
  release: (holdId: string) => Promise<void>;
}

export class MockPayments implements PaymentsAdapter {
  private holds = new Map<string, number>();
  async reserve(usd: number) {
    const holdId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.holds.set(holdId, usd);
    return { holdId };
  }
  async settle(holdId: string) { this.holds.delete(holdId); }
  async release(holdId: string) { this.holds.delete(holdId); }
}

/**
 * MnemoPayAdapter binds Praetor's CFO gate to MnemoPay's HITL flow. The actual
 * MnemoPay client is injected so this package stays free of a hard runtime dep.
 */
export interface MnemoPayClient {
  chargeRequest: (args: { amount: number; description: string }) => Promise<{ id: string }>;
  settle: (id: string, amount: number) => Promise<void>;
  refund: (id: string) => Promise<void>;
}

export class MnemoPayAdapter implements PaymentsAdapter {
  constructor(private client: MnemoPayClient) {}
  async reserve(usd: number) {
    const r = await this.client.chargeRequest({ amount: usd, description: "praetor.mission" });
    return { holdId: r.id };
  }
  async settle(holdId: string, usd: number) { await this.client.settle(holdId, usd); }
  async release(holdId: string) { await this.client.refund(holdId); }
}
