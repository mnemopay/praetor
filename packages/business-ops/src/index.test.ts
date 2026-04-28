import { describe, it, expect, vi } from "vitest";
import {
  BusinessOps,
  MockEmailSender,
  MockBiller,
  MockScheduler,
  InMemoryContactStore,
  invoiceTotal,
  renderInvoiceText,
  CalComScheduler,
  StripeBiller,
  CalComApiScheduler,
  MailerooSender,
  auditedBusinessOps,
  defaultBusinessOps,
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

  it("StripeBiller posts a Checkout Session and surfaces the payment URL", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/cs_test_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const b = new StripeBiller("sk_test_x", { fetchImpl });
    const r = await b.issue({
      id: "INV-9", customerEmail: "a@b.com",
      lineItems: [{ description: "AI Audit", quantity: 1, unitPriceUsd: 997 }],
    });
    expect(r.paymentLink).toBe("https://checkout.stripe.com/c/cs_test_123");
    expect(r.totalUsd).toBe(997);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(((call[1] as RequestInit).body as string)).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=99700");
  });

  it("CalComApiScheduler falls back to public link when no startAt", async () => {
    const a = new CalComApiScheduler({ apiKey: "k", username: "jerry" });
    const r = await a.schedule({ title: "x", attendeeEmail: "a@b.com", eventTypeSlug: "intro-30m" });
    expect(r.bookingUrl).toBe("https://cal.com/jerry/intro-30m");
  });

  it("CalComApiScheduler posts /v2/bookings when startAt + eventTypeId given", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { uid: "BK-1" } }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const a = new CalComApiScheduler({ apiKey: "k", username: "jerry", eventTypeId: 123, fetchImpl });
    const r = await a.schedule({
      title: "x", attendeeEmail: "a@b.com", eventTypeSlug: "intro-30m",
      startAt: "2026-05-01T15:00:00Z",
    });
    expect(r.id).toBe("BK-1");
    expect(r.bookingUrl).toBe("https://app.cal.com/booking/BK-1");
  });

  it("auditedBusinessOps records every operation into the audit sink", async () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const audit = { record: (type: string, data: Record<string, unknown>) => { events.push({ type, data }); } };
    const ops = auditedBusinessOps(BusinessOps.mock(), audit);
    await ops.email.send({ to: "a@b.com", from: "x@y.com", subject: "s", text: "t" });
    await ops.biller.issue({ id: "INV-1", customerEmail: "a@b.com", lineItems: [{ description: "x", quantity: 1, unitPriceUsd: 10 }] });
    await ops.scheduler.schedule({ title: "demo", attendeeEmail: "a@b.com", eventTypeSlug: "intro-30m" });
    await ops.contacts.upsert({ email: "a@b.com", tags: ["lead"] });
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "email.send.start",
      "email.send.ok",
      "invoice.issue.start",
      "invoice.issue.ok",
      "meeting.schedule.start",
      "meeting.schedule.ok",
      "contact.upsert",
    ]);
  });

  it("defaultBusinessOps wires Maileroo + Stripe + Cal.com from env", () => {
    const env = {
      MAILEROO_API_KEY: "m",
      STRIPE_SECRET_KEY: "sk_x",
      CALCOM_API_KEY: "c",
      CAL_USERNAME: "jerry",
    } as unknown as NodeJS.ProcessEnv;
    const ops = defaultBusinessOps(env);
    expect(ops.email).toBeInstanceOf(MailerooSender);
    expect(ops.biller).toBeInstanceOf(StripeBiller);
    expect(ops.scheduler).toBeInstanceOf(CalComApiScheduler);
  });

  it("defaultBusinessOps falls back to mocks when env is empty", () => {
    const ops = defaultBusinessOps({} as NodeJS.ProcessEnv);
    expect(ops.email).toBeInstanceOf(MockEmailSender);
    expect(ops.biller).toBeInstanceOf(MockBiller);
    expect(ops.scheduler).toBeInstanceOf(MockScheduler);
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
