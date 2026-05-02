import { auditedBusinessOps, defaultBusinessOps } from "../packages/business-ops/dist/index.js";

async function main() {
  console.log("Running BusinessOps Smoke Tests in dryRun mode...");
  try {
    const ops = defaultBusinessOps({});
    
    // Test Email
    const emailRes = await ops.email.send({ to: "test@example.com", from: "agent@praetor.local", subject: "Smoke Test", text: "Smoke test" });
    if (!emailRes.id) throw new Error("Email dryRun failed");

    // Test Billing
    const invoiceRes = await ops.biller.issue({ id: "inv_123", customerEmail: "test@example.com", lineItems: [{ description: "Test", quantity: 1, unitPriceUsd: 100 }] });
    if (!invoiceRes.paymentLink) throw new Error("Billing dryRun failed");

    // Test Scheduling
    const scheduleRes = await ops.scheduler.schedule({ title: "Test", attendeeEmail: "test@example.com", eventTypeSlug: "test" });
    if (!scheduleRes.bookingUrl) throw new Error("Scheduling dryRun failed");

    console.log("Smoke tests passed.");
  } catch (e) {
    console.error("Smoke test failed:", e);
    process.exit(1);
  }
}
main();
