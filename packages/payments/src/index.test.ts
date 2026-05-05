import { describe, it, expect, vi } from "vitest";
import {
  MockPayments,
  MnemoPayAdapter,
  type MnemoPayClient,
  type PaymentsAdapter,
} from "./index.js";

describe("MockPayments", () => {
  it("reserves a hold and returns a unique mock id", async () => {
    const p = new MockPayments();
    const a = await p.reserve(10);
    const b = await p.reserve(10);
    expect(a.holdId).toMatch(/^mock_/);
    expect(b.holdId).toMatch(/^mock_/);
    expect(a.holdId).not.toBe(b.holdId);
  });

  it("settle removes the hold", async () => {
    const p = new MockPayments();
    const { holdId } = await p.reserve(5);
    // MockPayments.settle ignores the usd arg — interface requires it but
    // implementation is single-arg. Cast keeps the contract test simple.
    await expect((p.settle as (h: string) => Promise<void>)(holdId)).resolves.toBeUndefined();
  });

  it("release removes the hold", async () => {
    const p = new MockPayments();
    const { holdId } = await p.reserve(7);
    await expect(p.release(holdId)).resolves.toBeUndefined();
  });

  it("settle / release on unknown holdId is a no-op (idempotent)", async () => {
    const p = new MockPayments();
    await expect((p.settle as (h: string) => Promise<void>)("unknown")).resolves.toBeUndefined();
    await expect(p.release("unknown")).resolves.toBeUndefined();
  });

  it("conforms to the PaymentsAdapter interface", () => {
    const p: PaymentsAdapter = new MockPayments();
    expect(typeof p.reserve).toBe("function");
    expect(typeof p.settle).toBe("function");
    expect(typeof p.release).toBe("function");
  });
});

describe("MnemoPayAdapter", () => {
  function fakeClient(): { client: MnemoPayClient; calls: any[] } {
    const calls: any[] = [];
    const client: MnemoPayClient = {
      chargeRequest: vi.fn(async (args) => {
        calls.push({ method: "chargeRequest", args });
        return { id: `charge_${calls.length}` };
      }),
      settle: vi.fn(async (id, amount) => {
        calls.push({ method: "settle", id, amount });
      }),
      refund: vi.fn(async (id) => {
        calls.push({ method: "refund", id });
      }),
    };
    return { client, calls };
  }

  it("reserve forwards usd + canonical description to chargeRequest", async () => {
    const { client, calls } = fakeClient();
    const a = new MnemoPayAdapter(client);
    const out = await a.reserve(12.5);
    expect(out.holdId).toBe("charge_1");
    expect(calls).toEqual([
      {
        method: "chargeRequest",
        args: { amount: 12.5, description: "praetor.mission" },
      },
    ]);
  });

  it("settle calls client.settle with holdId + amount", async () => {
    const { client, calls } = fakeClient();
    const a = new MnemoPayAdapter(client);
    await a.settle("h1", 4);
    expect(calls).toContainEqual({ method: "settle", id: "h1", amount: 4 });
  });

  it("release calls client.refund", async () => {
    const { client, calls } = fakeClient();
    const a = new MnemoPayAdapter(client);
    await a.release("h2");
    expect(calls).toContainEqual({ method: "refund", id: "h2" });
  });

  it("propagates rejection from underlying client", async () => {
    const client: MnemoPayClient = {
      chargeRequest: async () => {
        throw new Error("insufficient funds");
      },
      settle: async () => {},
      refund: async () => {},
    };
    const a = new MnemoPayAdapter(client);
    await expect(a.reserve(1)).rejects.toThrow("insufficient funds");
  });
});
