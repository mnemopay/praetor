import { createHash } from "node:crypto";

interface AuditEvent {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export class MerkleAudit {
  private events: AuditEvent[] = [];
  private chain: string[] = [];

  record(type: string, data: Record<string, unknown>) {
    const ev: AuditEvent = { ts: new Date().toISOString(), type, data };
    this.events.push(ev);
    const prev = this.chain[this.chain.length - 1] ?? "";
    const next = createHash("sha256").update(prev + JSON.stringify(ev)).digest("hex");
    this.chain.push(next);
  }

  finalize(): string {
    return this.chain[this.chain.length - 1] ?? createHash("sha256").update("").digest("hex");
  }

  toJSON() {
    return { events: this.events, chain: this.chain };
  }
}
