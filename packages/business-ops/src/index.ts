/**
 * Praetor Business-Ops pack — the layer that lets a charter actually run a
 * business: send outbound, take payment, schedule meetings, generate quotes
 * and invoices, and keep contacts in a CRM.
 *
 * Every surface ships with two adapters:
 *
 *   - a `Mock*` adapter: deterministic, in-memory, no network — used by the
 *     test suite and by `praetor run --dry` to flow a charter end-to-end
 *     before spending real money or real reputation;
 *   - a `Live*` adapter: thin binding over the upstream API (Maileroo,
 *     Stripe, Cal.com, etc.) — wired on production but not exercised in CI.
 *
 * The contracts intentionally stay narrow: a charter declares "send email",
 * "issue invoice", "schedule call" — the runtime decides which adapter to
 * dispatch through based on the mission's environment.
 */

// ---------- outbound email ---------------------------------------------------

export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  id: string;
  status: "queued" | "sent" | "rejected";
  provider: string;
}

export interface EmailSender {
  send: (msg: OutboundEmail) => Promise<EmailSendResult>;
}

/**
 * Live Maileroo binding. Maileroo is the user's primary SMTP provider per
 * memory (`reference_maileroo.md`, 300/day free tier, SPF+DKIM verified on
 * getbizsuite.com). The body intentionally maps onto Maileroo's HTTP API
 * shape so a charter can swap to another provider without copy-paste churn.
 */
export class MailerooSender implements EmailSender {
  constructor(private readonly apiKey: string) {}
  async send(msg: OutboundEmail): Promise<EmailSendResult> {
    if (!this.apiKey) throw new Error("MailerooSender: missing apiKey");
    const res = await fetch("https://smtp.maileroo.com/api/v2/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: { address: msg.from },
        to: [{ address: msg.to }],
        subject: msg.subject,
        plain: msg.text,
        html: msg.html,
        reply_to: msg.replyTo ? { address: msg.replyTo } : undefined,
        tags: msg.tags,
      }),
    });
    const data = (await res.json()) as { reference_id?: string; data?: { reference_id?: string } };
    return {
      id: data.reference_id ?? data.data?.reference_id ?? `maileroo:${Date.now()}`,
      status: res.ok ? "sent" : "rejected",
      provider: "maileroo",
    };
  }
}

/**
 * Mock sender — accepts every message, stores them on `sent`, never touches
 * the network. Charter dry-runs and the test suite use this.
 */
export class MockEmailSender implements EmailSender {
  readonly sent: OutboundEmail[] = [];
  async send(msg: OutboundEmail): Promise<EmailSendResult> {
    this.sent.push(msg);
    return { id: `mock:${this.sent.length}`, status: "sent", provider: "mock" };
  }
}

// ---------- billing ---------------------------------------------------------

export interface Invoice {
  /** Stable invoice id (e.g., `INV-2026-0001`). */
  id: string;
  customerEmail: string;
  customerName?: string;
  /** Line items priced in the invoice currency (default USD). */
  lineItems: { description: string; quantity: number; unitPriceUsd: number }[];
  /** ISO 8601 due date. */
  dueAt?: string;
  /** Optional terms / notes block. */
  notes?: string;
}

export interface InvoiceResult {
  invoice: Invoice;
  totalUsd: number;
  paymentLink?: string;
  provider: string;
}

export interface Biller {
  issue: (i: Invoice) => Promise<InvoiceResult>;
}

/**
 * Live Stripe binding. Posts a Checkout Session with inline `price_data` for
 * each line item — a single API call that mints a hosted payment URL without
 * requiring pre-created Stripe Products/Prices. Form-encoded per Stripe's
 * convention.
 */
export class StripeBiller implements Biller {
  constructor(
    private readonly apiKey: string,
    private readonly opts: { successUrl?: string; cancelUrl?: string; fetchImpl?: typeof fetch } = {},
  ) {}
  async issue(inv: Invoice): Promise<InvoiceResult> {
    if (!this.apiKey) throw new Error("StripeBiller: missing apiKey");
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", this.opts.successUrl ?? "https://getbizsuite.com/thanks");
    params.set("cancel_url", this.opts.cancelUrl ?? "https://getbizsuite.com/cancel");
    params.set("client_reference_id", inv.id);
    if (inv.customerEmail) params.set("customer_email", inv.customerEmail);
    inv.lineItems.forEach((li, i) => {
      params.set(`line_items[${i}][price_data][currency]`, "usd");
      params.set(`line_items[${i}][price_data][product_data][name]`, li.description);
      params.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(li.unitPriceUsd * 100)));
      params.set(`line_items[${i}][quantity]`, String(li.quantity));
    });
    const res = await f("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`StripeBiller: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { id?: string; url?: string };
    return {
      invoice: inv,
      totalUsd: invoiceTotal(inv),
      paymentLink: data.url,
      provider: "stripe",
    };
  }
}

export class MockBiller implements Biller {
  readonly issued: Invoice[] = [];
  async issue(inv: Invoice): Promise<InvoiceResult> {
    this.issued.push(inv);
    return {
      invoice: inv,
      totalUsd: invoiceTotal(inv),
      paymentLink: `https://mock.invoice/${inv.id}`,
      provider: "mock",
    };
  }
}

export function invoiceTotal(inv: Invoice): number {
  return Number(
    inv.lineItems.reduce((acc, li) => acc + li.quantity * li.unitPriceUsd, 0).toFixed(2),
  );
}

/**
 * Render a plain-text invoice — useful when a charter wants to email the
 * invoice as part of the body or attach it as `.txt`. HTML-template variant
 * lives in the design pack so business-ops stays dependency-free.
 */
export function renderInvoiceText(inv: Invoice): string {
  const lines: string[] = [];
  lines.push(`INVOICE ${inv.id}`);
  lines.push(`Bill to: ${inv.customerName ?? ""} <${inv.customerEmail}>`);
  if (inv.dueAt) lines.push(`Due:     ${inv.dueAt}`);
  lines.push("");
  lines.push("Description                      Qty   Unit       Line");
  lines.push("---------------------------------------------------------------");
  for (const li of inv.lineItems) {
    const desc = li.description.padEnd(32).slice(0, 32);
    const qty = String(li.quantity).padStart(4);
    const unit = li.unitPriceUsd.toFixed(2).padStart(10);
    const lineTotal = (li.quantity * li.unitPriceUsd).toFixed(2).padStart(10);
    lines.push(`${desc} ${qty} ${unit} ${lineTotal}`);
  }
  lines.push("---------------------------------------------------------------");
  lines.push(`TOTAL`.padEnd(48) + invoiceTotal(inv).toFixed(2).padStart(15));
  if (inv.notes) {
    lines.push("");
    lines.push(inv.notes);
  }
  return lines.join("\n");
}

// ---------- scheduling ------------------------------------------------------

export interface MeetingRequest {
  title: string;
  attendeeEmail: string;
  attendeeName?: string;
  /** Cal.com event-type slug (e.g., "intro-30m"). */
  eventTypeSlug: string;
  /** ISO 8601 start (or omit and let scheduler pick). */
  startAt?: string;
  /** Minutes; defaults to 30. */
  durationMinutes?: number;
  notes?: string;
}

export interface MeetingResult {
  id: string;
  bookingUrl: string;
  startAt?: string;
  provider: string;
}

export interface Scheduler {
  schedule: (req: MeetingRequest) => Promise<MeetingResult>;
}

export class CalComScheduler implements Scheduler {
  constructor(private readonly username: string) {}
  async schedule(req: MeetingRequest): Promise<MeetingResult> {
    const url = `https://cal.com/${encodeURIComponent(this.username)}/${encodeURIComponent(req.eventTypeSlug)}`;
    return {
      id: `cal:${this.username}:${req.eventTypeSlug}:${Date.now()}`,
      bookingUrl: url,
      startAt: req.startAt,
      provider: "cal.com",
    };
  }
}

/**
 * Live Cal.com v2 booking. If `startAt` is supplied, posts to /v2/bookings to
 * lock the slot directly (returns a real bookingUid). If not, falls back to
 * the public booking link so a charter can defer slot selection to the
 * attendee.
 */
export class CalComApiScheduler implements Scheduler {
  constructor(
    private readonly opts: {
      apiKey: string;
      username: string;
      eventTypeId?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}
  async schedule(req: MeetingRequest): Promise<MeetingResult> {
    if (!req.startAt || !this.opts.eventTypeId) {
      return new CalComScheduler(this.opts.username).schedule(req);
    }
    const f = this.opts.fetchImpl ?? globalThis.fetch;
    const res = await f("https://api.cal.com/v2/bookings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        "content-type": "application/json",
        "cal-api-version": "2024-08-13",
      },
      body: JSON.stringify({
        eventTypeId: this.opts.eventTypeId,
        start: req.startAt,
        attendee: {
          name: req.attendeeName ?? req.attendeeEmail,
          email: req.attendeeEmail,
          timeZone: "UTC",
        },
        lengthInMinutes: req.durationMinutes,
        metadata: req.notes ? { notes: req.notes } : undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CalComApiScheduler: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { uid?: string; bookingUid?: string }; uid?: string };
    const id = data.data?.uid ?? data.data?.bookingUid ?? data.uid ?? `cal:${Date.now()}`;
    return {
      id,
      bookingUrl: `https://app.cal.com/booking/${id}`,
      startAt: req.startAt,
      provider: "cal.com",
    };
  }
}

export class MockScheduler implements Scheduler {
  readonly scheduled: MeetingRequest[] = [];
  async schedule(req: MeetingRequest): Promise<MeetingResult> {
    this.scheduled.push(req);
    return {
      id: `mock:${this.scheduled.length}`,
      bookingUrl: `https://mock.cal/${req.eventTypeSlug}`,
      startAt: req.startAt,
      provider: "mock",
    };
  }
}

// ---------- contact CRM -----------------------------------------------------

export interface Contact {
  email: string;
  name?: string;
  company?: string;
  source?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  firstSeenAt?: string;
  lastTouchedAt?: string;
}

/**
 * Tiny in-memory CRM. Charters use it through the runtime so contacts gathered
 * during a mission persist into the audit trail. Production deploys plug a
 * real backend (Postgres, Notion, Airtable) by implementing `ContactStore`.
 */
export interface ContactStore {
  upsert: (c: Contact) => Promise<Contact>;
  get: (email: string) => Promise<Contact | undefined>;
  list: (filter?: { tag?: string }) => Promise<Contact[]>;
  remove: (email: string) => Promise<{ removed: boolean }>;
}

export class InMemoryContactStore implements ContactStore {
  private readonly map = new Map<string, Contact>();
  async upsert(c: Contact): Promise<Contact> {
    const now = new Date().toISOString();
    const prev = this.map.get(c.email);
    const merged: Contact = {
      ...prev,
      ...c,
      tags: dedupe([...(prev?.tags ?? []), ...(c.tags ?? [])]),
      firstSeenAt: prev?.firstSeenAt ?? now,
      lastTouchedAt: now,
    };
    this.map.set(c.email, merged);
    return merged;
  }
  async get(email: string): Promise<Contact | undefined> {
    return this.map.get(email);
  }
  async list(filter: { tag?: string } = {}): Promise<Contact[]> {
    const all = [...this.map.values()];
    if (!filter.tag) return all;
    return all.filter((c) => (c.tags ?? []).includes(filter.tag!));
  }
  async remove(email: string): Promise<{ removed: boolean }> {
    return { removed: this.map.delete(email) };
  }
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

// ---------- bundle ----------------------------------------------------------

/**
 * Convenience facade — a charter that wants the kitchen-sink set of business
 * primitives gets one constructor call. Each surface stays independent so a
 * charter can also pick exactly what it needs.
 */
export class BusinessOps {
  constructor(
    public email: EmailSender,
    public biller: Biller,
    public scheduler: Scheduler,
    public contacts: ContactStore = new InMemoryContactStore(),
  ) {}

  static mock(): BusinessOps {
    return new BusinessOps(new MockEmailSender(), new MockBiller(), new MockScheduler());
  }
}

// ---------- audit wrapper + factory ----------------------------------------

/** Minimal shape of a Merkle-style auditor. Matches @praetor/core MerkleAudit. */
export interface AuditSink {
  record: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Wrap any BusinessOps so every email / invoice / meeting / contact mutation
 * lands in the Merkle chain. Uses the same auditor a charter mission already
 * uses, so the Article 12 bundle picks these events up automatically.
 */
export function auditedBusinessOps(ops: BusinessOps, audit: AuditSink): BusinessOps {
  const email: EmailSender = {
    send: async (msg) => {
      audit.record("email.send.start", { to: msg.to, subject: msg.subject, provider: detectProvider(ops.email) });
      try {
        const r = await ops.email.send(msg);
        audit.record("email.send.ok", { to: msg.to, id: r.id, status: r.status, provider: r.provider });
        return r;
      } catch (e) {
        audit.record("email.send.error", { to: msg.to, error: (e as Error).message });
        throw e;
      }
    },
  };
  const biller: Biller = {
    issue: async (inv) => {
      audit.record("invoice.issue.start", { id: inv.id, customerEmail: inv.customerEmail, total: invoiceTotal(inv) });
      try {
        const r = await ops.biller.issue(inv);
        audit.record("invoice.issue.ok", { id: inv.id, totalUsd: r.totalUsd, paymentLink: r.paymentLink, provider: r.provider });
        return r;
      } catch (e) {
        audit.record("invoice.issue.error", { id: inv.id, error: (e as Error).message });
        throw e;
      }
    },
  };
  const scheduler: Scheduler = {
    schedule: async (req) => {
      audit.record("meeting.schedule.start", { attendee: req.attendeeEmail, slug: req.eventTypeSlug, startAt: req.startAt });
      try {
        const r = await ops.scheduler.schedule(req);
        audit.record("meeting.schedule.ok", { id: r.id, bookingUrl: r.bookingUrl, provider: r.provider });
        return r;
      } catch (e) {
        audit.record("meeting.schedule.error", { attendee: req.attendeeEmail, error: (e as Error).message });
        throw e;
      }
    },
  };
  const contacts: ContactStore = {
    upsert: async (c) => {
      const r = await ops.contacts.upsert(c);
      audit.record("contact.upsert", { email: c.email, tags: c.tags ?? [] });
      return r;
    },
    get: (e) => ops.contacts.get(e),
    list: (f) => ops.contacts.list(f),
    remove: async (e) => {
      const r = await ops.contacts.remove(e);
      if (r.removed) audit.record("contact.remove", { email: e });
      return r;
    },
  };
  return new BusinessOps(email, biller, scheduler, contacts);
}

function detectProvider(s: EmailSender): string {
  if (s instanceof MailerooSender) return "maileroo";
  if (s instanceof MockEmailSender) return "mock";
  return "unknown";
}

/**
 * Resolve the live BusinessOps stack from environment. Reads:
 *   MAILEROO_API_KEY                → live Maileroo email
 *   STRIPE_SECRET_KEY (sk_*)        → live Stripe Checkout billing
 *   CALCOM_API_KEY + CAL_USERNAME   → live Cal.com booking (with optional CALCOM_EVENT_TYPE_ID)
 *   CAL_USERNAME alone              → public Cal.com link only
 * Anything missing falls back to the mock adapter so a partial environment
 * still runs end-to-end.
 */
export function defaultBusinessOps(env: NodeJS.ProcessEnv = process.env): BusinessOps {
  const email: EmailSender = env.MAILEROO_API_KEY ? new MailerooSender(env.MAILEROO_API_KEY) : new MockEmailSender();

  const stripeKey = env.STRIPE_SECRET_KEY ?? env.STRIPE_API_KEY;
  const biller: Biller = stripeKey
    ? new StripeBiller(stripeKey, {
        successUrl: env.STRIPE_SUCCESS_URL,
        cancelUrl: env.STRIPE_CANCEL_URL,
      })
    : new MockBiller();

  let scheduler: Scheduler;
  if (env.CALCOM_API_KEY && env.CAL_USERNAME) {
    scheduler = new CalComApiScheduler({
      apiKey: env.CALCOM_API_KEY,
      username: env.CAL_USERNAME,
      eventTypeId: env.CALCOM_EVENT_TYPE_ID ? Number(env.CALCOM_EVENT_TYPE_ID) : undefined,
    });
  } else if (env.CAL_USERNAME) {
    scheduler = new CalComScheduler(env.CAL_USERNAME);
  } else {
    scheduler = new MockScheduler();
  }

  return new BusinessOps(email, biller, scheduler);
}
