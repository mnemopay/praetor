import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// env.ts asserts SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at module load,
// so they must be set before any transitive import touches them. Pin the
// repo root to a tmp dir so each test file has its own inbox sandbox.
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test";
process.env.PRAETOR_REPO_ROOT = mkdtempSync(join(tmpdir(), "praetor-inbox-"));

describe("recordMissionChatMessage", () => {
  beforeAll(async () => {
    // Force lazy-load now that env is wired.
    await import("./runner.js");
  });

  it("appends a chat.user event to the per-mission inbox and publishes it", async () => {
    const { recordMissionChatMessage, missionInboxPath } = await import("./runner.js");
    const { getActivityBus } = await import("./activity.js");
    const missionId = "m-test-1";
    const seen: unknown[] = [];
    const unsub = getActivityBus().subscribe((e) => seen.push(e));
    try {
      const { event, inboxPath } = await recordMissionChatMessage({
        missionId,
        text: "follow-up question",
        role: "user",
      });
      expect(event.kind).toBe("chat.user");
      if (event.kind === "chat.user") {
        expect(event.text).toBe("follow-up question");
        expect(event.missionId).toBe(missionId);
        expect(typeof event.messageId).toBe("string");
      }
      expect(inboxPath).toBe(missionInboxPath(missionId));
      expect(existsSync(inboxPath)).toBe(true);
      const persisted = readFileSync(inboxPath, "utf8").trim().split("\n").pop()!;
      const reparsed = JSON.parse(persisted);
      expect(reparsed.kind).toBe("chat.user");
      expect(reparsed.text).toBe("follow-up question");
      expect(seen.some((e) => (e as { kind: string }).kind === "chat.user")).toBe(true);
    } finally {
      unsub();
    }
  });

  it("supports an assistant role for praetor reply persistence", async () => {
    const { recordMissionChatMessage } = await import("./runner.js");
    const missionId = "m-test-2";
    const { event, inboxPath } = await recordMissionChatMessage({
      missionId,
      text: "running tool x...",
      role: "assistant",
    });
    expect(event.kind).toBe("chat.assistant");
    const persisted = readFileSync(inboxPath, "utf8").trim().split("\n").pop()!;
    expect(JSON.parse(persisted).kind).toBe("chat.assistant");
  });

  it("appends multiple messages to the same inbox file", async () => {
    const { recordMissionChatMessage, missionInboxPath } = await import("./runner.js");
    const missionId = "m-test-3";
    await recordMissionChatMessage({ missionId, text: "first", role: "user" });
    await recordMissionChatMessage({ missionId, text: "second", role: "assistant" });
    await recordMissionChatMessage({ missionId, text: "third", role: "user" });
    const lines = readFileSync(missionInboxPath(missionId), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.text)).toEqual(["first", "second", "third"]);
    expect(parsed.map((p) => p.kind)).toEqual(["chat.user", "chat.assistant", "chat.user"]);
  });
});
