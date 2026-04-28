import { describe, it, expect } from "vitest";
import {
  BusinessOps,
  MockEmailSender,
  MockBiller,
  MockScheduler,
  InMemoryContactStore,
  invoiceTotal,
  renderInvoiceText,
  CalComScheduler,
} from "./index.js";

describe("Praetor business-ops pack", () => {
  it("BusinessOps.mock() wires every surface to in-memory adapters", async () => {
    const ops = BusinessOps.mock();
    const sent = await ops.email.send({
      to: "x@y.com", from: "a@b.com", subject: "hi", text: "hello",
    });
    expect(sent.status).toBe("sent");
    const inv = await ops.biller.issue({
      id: "INV-1", customerEmail: "x@y.com",
      lineItems: [{ description: "audit", quantity: 1, unitPriceUsd: 997 }],
    });
    expect(inv.totalUsd).toBe(997);
    const meet = await ops.scheduler.schedule({
      title: "intro", attendeeEmail: "x@y.com", eventTypeSlug: "intro-30m",
    });
    expect(meet.bookingUrl).toContain("intro-30m");
  });

  it("invoice total + plaintext render", () => {
    const inv = {
      id: "INV-2",
      customerEmail: "x@y.com",
      lineItems: [
        { description: "Audit", quantity: 1, unitPriceUsd: 997 },
        { description: "Add-on", quantity: 2, unitPriceUsd: 49.5 },
      ],
    };
    expect(invoiceTotal(inv)).toBe(1096);
    const t = renderInvoiceText(inv);
    expect(t).toContain("INVOICE INV-2");
    expect(t).toContain("Audit");
    expect(t).toContain("1096.00");
  });

  it("MockEmailSender records every send", async () => {
    const m = new MockEmailSender();
    await m.send({ to: "a", from: "b", subject: "s", text: "t" });
    await m.send({ to: "c", from: "b", subject: "s2", text: "t" });
    expect(m.sent).toHaveLength(2);
  });

  it("MockBiller stores issued invoices", async () => {
    const b = new MockBiller();
    const r = await b.issue({
      id: "I1", customerEmail: "a@b.com",
      lineItems: [{ description: "x", quantity: 1, unitPriceUsd: 10 }],
    });
    expect(r.paymentLink).toContain("I1");
    expect(b.issued).toHaveLength(1);
  });

  it("CalComScheduler emits a deterministic booking URL", async () => {
    const c = new CalComScheduler("jeremiah");
    const r = await c.schedule({
      title: "demo", attendeeEmail: "a@b.com", eventTypeSlug: "audit-30m",
    });
    expect(r.bookingUrl).toBe("https://cal.com/jeremiah/audit-30m");
  });

  it("InMemoryContactStore upsert + tag list", async () => {
    const cs = new InMemoryContactStore();
    await cs.upsert({ email: "a@b.com", name: "A", tags: ["lead"] });
    await cs.upsert({ email: "a@b.com", tags: ["audit"] });
    const all = await cs.list();
    expect(all).toHaveLength(1);
    expect(all[0].tags).toEqual(["lead", "audit"]);
    const audits = await cs.list({ tag: "audit" });
    expect(audits).toHaveLength(1);
    const removed = await cs.remove("a@b.com");
    expect(removed).toEqual({ removed: true });
    expect(await cs.list()).toHaveLength(0);
  });
});
