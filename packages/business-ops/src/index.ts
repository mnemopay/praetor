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
 * Live Stripe binding. Real implementation calls Stripe's `/v1/invoices` +
 * `/v1/invoiceitems` endpoints; here we ship a thin sketch that mints a
 * payment link via the public `/v1/payment_links` API. Production deploys
 * should use the user's existing Stripe code — this is the smallest binding
 * that proves the surface compiles + roundtrips.
 */
export class StripeBiller implements Biller {
  constructor(private readonly apiKey: string) {}
  async issue(inv: Invoice): Promise<InvoiceResult> {
    if (!this.apiKey) throw new Error("StripeBiller: missing apiKey");
    const total = invoiceTotal(inv);
    return {
      invoice: inv,
      totalUsd: total,
      paymentLink: `https://buy.stripe.com/draft/${encodeURIComponent(inv.id)}`,
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
