import { describe, it, expect, beforeEach } from "vitest";
import { ActivityPanel, type ActivityEvent } from "./ActivityPanel.js";

/**
 * The panel writes into `host.innerHTML` and only reads `scrollTop`/
 * `scrollHeight` for auto-scroll. A minimal stub is enough to exercise the
 * rendering branches without pulling jsdom into devDeps.
 */
class FakeHost {
  innerHTML = "";
  scrollTop = 0;
  scrollHeight = 0;
}

function fakeHost(): HTMLElement {
  return new FakeHost() as unknown as HTMLElement;
}

describe("ActivityPanel — chat events", () => {
  let host: HTMLElement;
  let panel: ActivityPanel;

  beforeEach(() => {
    host = fakeHost();
    panel = new ActivityPanel(host);
  });

  it("renders a chat.user message with the 'you' label and user variant", () => {
    panel.push({
      kind: "chat.user",
      missionId: "m-1",
      messageId: "msg-1",
      text: "follow up: skip the second test",
      ts: new Date().toISOString(),
    });
    expect(host.innerHTML).toContain("activity-chat-user");
    expect(host.innerHTML).toContain(">you<");
    expect(host.innerHTML).toContain("follow up: skip the second test");
  });

  it("renders a chat.assistant message with the 'praetor' label and assistant variant", () => {
    panel.push({
      kind: "chat.assistant",
      missionId: "m-1",
      messageId: "msg-2",
      text: "got it, skipping the second test now",
      ts: new Date().toISOString(),
    });
    expect(host.innerHTML).toContain("activity-chat-assistant");
    expect(host.innerHTML).toContain(">praetor<");
    expect(host.innerHTML).toContain("got it, skipping");
  });

  it("interleaves chat + tool events in insertion order", () => {
    const events: ActivityEvent[] = [
      { kind: "chat.user", missionId: "m-1", messageId: "u1", text: "go", ts: "t0" },
      { kind: "tool.start", missionId: "m-1", eventId: "t1", toolName: "read_file", args: {}, ts: "t1" },
      { kind: "tool.end", missionId: "m-1", eventId: "t1", ok: true, ts: "t2" },
      { kind: "chat.assistant", missionId: "m-1", messageId: "a1", text: "done", ts: "t3" },
    ];
    for (const e of events) panel.push(e);
    const html = host.innerHTML;
    const userIdx = html.indexOf("activity-chat-user");
    const toolIdx = html.indexOf("activity-tool");
    const assistantIdx = html.indexOf("activity-chat-assistant");
    expect(userIdx).toBeGreaterThan(-1);
    expect(toolIdx).toBeGreaterThan(userIdx);
    expect(assistantIdx).toBeGreaterThan(toolIdx);
  });

  it("escapes chat content to prevent XSS", () => {
    panel.push({
      kind: "chat.user",
      missionId: "m-1",
      messageId: "msg-x",
      text: "<script>alert('x')</script>",
      ts: "t",
    });
    expect(host.innerHTML).not.toContain("<script>alert");
    expect(host.innerHTML).toContain("&lt;script&gt;");
  });

  it("hydrate() bulk-loads events without breaking ordering", () => {
    panel.hydrate([
      { kind: "chat.user", missionId: "m-1", messageId: "u1", text: "first", ts: "t0" },
      { kind: "chat.assistant", missionId: "m-1", messageId: "a1", text: "second", ts: "t1" },
    ]);
    const html = host.innerHTML;
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  it("reset() clears prior events including chat rows", () => {
    panel.push({ kind: "chat.user", missionId: "m-1", messageId: "u1", text: "old", ts: "t" });
    panel.reset();
    expect(host.innerHTML).not.toContain("activity-chat");
    expect(host.innerHTML).toContain("No activity yet");
  });
});
