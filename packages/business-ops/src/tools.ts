import { ToolRegistry } from "@praetor/tools";
import { BusinessOps, defaultBusinessOps, OutboundEmail, Invoice, MeetingRequest, Contact } from "./index.js";

export interface BusinessOpsToolsOptions {
  /** Provide an explicit BusinessOps instance. If omitted, uses defaultBusinessOps(). */
  ops?: BusinessOps;
}

export function registerBusinessOpsTools(reg: ToolRegistry, opts: BusinessOpsToolsOptions = {}): void {
  const defaultOps = opts.ops ?? defaultBusinessOps();
  const mockOps = BusinessOps.mock();
  const tags = ["business", "side-effect"] as const;
  const allowedRoles = ["business", "native"] as const;

  reg.register<{ msg: OutboundEmail; dryRun?: boolean }, { id: string; status: string; provider: string }>(
    {
      name: "send_email",
      description: "Send an outbound email. Set dryRun to true to mock the send.",
      schema: {
        type: "object",
        properties: {
          msg: { type: "object", description: "The OutboundEmail object containing to, from, subject, text, and html." },
          dryRun: { type: "boolean" },
        },
        required: ["msg"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "email_send", risk: ["reputation"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ msg, dryRun }) => {
      const ops = dryRun ? mockOps : defaultOps;
      return await ops.email.send(msg);
    }
  );

  reg.register<{ invoice: Invoice; dryRun?: boolean }, { totalUsd: number; paymentLink?: string; provider: string }>(
    {
      name: "issue_invoice",
      description: "Issue a billing invoice. Set dryRun to true to mock the creation.",
      schema: {
        type: "object",
        properties: {
          invoice: { type: "object", description: "The Invoice object containing id, customerEmail, and lineItems." },
          dryRun: { type: "boolean" },
        },
        required: ["invoice"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "invoice_issue", risk: ["payment"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ invoice, dryRun }) => {
      const ops = dryRun ? mockOps : defaultOps;
      const res = await ops.biller.issue(invoice);
      return { totalUsd: res.totalUsd, paymentLink: res.paymentLink, provider: res.provider };
    }
  );

  reg.register<{ request: MeetingRequest; dryRun?: boolean }, { id: string; bookingUrl: string; provider: string }>(
    {
      name: "schedule_meeting",
      description: "Schedule a meeting with a client. Set dryRun to true to mock the scheduling.",
      schema: {
        type: "object",
        properties: {
          request: { type: "object", description: "MeetingRequest object with title, attendeeEmail, and eventTypeSlug." },
          dryRun: { type: "boolean" },
        },
        required: ["request"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "meeting_schedule", risk: ["reputation"], approval: "on-side-effect", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ request, dryRun }) => {
      const ops = dryRun ? mockOps : defaultOps;
      return await ops.scheduler.schedule(request);
    }
  );

  reg.register<{ contact: Contact; dryRun?: boolean }, Contact>(
    {
      name: "upsert_contact",
      description: "Add or update a contact in the CRM. Set dryRun to true to mock the upsert.",
      schema: {
        type: "object",
        properties: {
          contact: { type: "object", description: "Contact object containing email and optional name." },
          dryRun: { type: "boolean" },
        },
        required: ["contact"],
      },
      tags, allowedRoles,
      metadata: { origin: "native", capability: "crm_upsert", risk: ["identity"], approval: "never", sandbox: "host", production: "ready", costEffective: true },
    },
    async ({ contact, dryRun }) => {
      const ops = dryRun ? mockOps : defaultOps;
      return await ops.contacts.upsert(contact);
    }
  );
}
