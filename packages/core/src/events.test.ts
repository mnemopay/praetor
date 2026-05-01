import { describe, it, expect } from "vitest";
import { InMemoryActivityBus, newActivityEventId } from "./events.js";
import type { ActivityEvent } from "./events.js";

describe("InMemoryActivityBus", () => {
  it("delivers published events to all current subscribers", () => {
    const bus = new InMemoryActivityBus();
    const a: ActivityEvent[] = [];
    const b: ActivityEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish({ kind: "milestone", missionId: "m1", text: "started", ts: new Date().toISOString() });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].kind).toBe("milestone");
  });

  it("returns an unsubscribe function that stops further deliveries", () => {
    const bus = new InMemoryActivityBus();
    const seen: ActivityEvent[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.publish({ kind: "milestone", missionId: "m1", text: "first", ts: "t" });
    unsub();
    bus.publish({ kind: "milestone", missionId: "m1", text: "second", ts: "t" });
    expect(seen.map((e) => (e.kind === "milestone" ? e.text : ""))).toEqual(["first"]);
  });

  it("survives a thrown listener — other listeners still receive the event", () => {
    const bus = new InMemoryActivityBus();
    const seen: ActivityEvent[] = [];
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe((e) => seen.push(e));
    bus.publish({ kind: "milestone", missionId: "m1", text: "x", ts: "t" });
    expect(seen.length).toBe(1);
  });

  it("newActivityEventId returns a non-empty unique string", () => {
    const a = newActivityEventId();
    const b = newActivityEventId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
