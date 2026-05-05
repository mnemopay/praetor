import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { post_x_tweet, post_tiktok_video, schedule_cron_job } from "./index.js";

const ENV_KEYS = ["X_API_KEY", "TIKTOK_API_KEY"] as const;

describe("@kpanks/social tools", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("post_x_tweet", () => {
    it("declares required schema fields", () => {
      expect(post_x_tweet.name).toBe("post_x_tweet");
      expect(post_x_tweet.parameters.required).toEqual(["content"]);
      expect(post_x_tweet.metadata.approval).toBe("always");
      expect(post_x_tweet.metadata.risk).toContain("external_publish");
    });

    it("returns a mocked response when X_API_KEY missing", async () => {
      const r = await post_x_tweet.execute({ content: "hello" });
      expect(r.ok).toBe(true);
      expect(r.mocked).toBe(true);
      expect(String(r.message)).toContain("hello");
    });

    it("returns the live-style response shape when X_API_KEY is set", async () => {
      process.env.X_API_KEY = "fake-test-key";
      const r = await post_x_tweet.execute({ content: "hi" });
      expect(r.ok).toBe(true);
      expect(r.mocked).toBeUndefined();
      expect(r.id).toBeDefined();
    });
  });

  describe("post_tiktok_video", () => {
    it("declares required schema fields", () => {
      expect(post_tiktok_video.name).toBe("post_tiktok_video");
      expect(post_tiktok_video.parameters.required).toEqual([
        "videoPath",
        "caption",
      ]);
      expect(post_tiktok_video.metadata.approval).toBe("always");
    });

    it("returns mocked response when TIKTOK_API_KEY missing", async () => {
      const r = await post_tiktok_video.execute({
        videoPath: "/tmp/x.mp4",
        caption: "ad",
      });
      expect(r.ok).toBe(true);
      expect(r.mocked).toBe(true);
      expect(String(r.message)).toContain("/tmp/x.mp4");
      expect(String(r.message)).toContain("ad");
    });

    it("returns the live-style response shape when TIKTOK_API_KEY is set", async () => {
      process.env.TIKTOK_API_KEY = "fake-test-key";
      const r = await post_tiktok_video.execute({
        videoPath: "/tmp/x.mp4",
        caption: "ad",
      });
      expect(r.ok).toBe(true);
      expect(r.mocked).toBeUndefined();
      expect(r.id).toBeDefined();
    });
  });

  describe("schedule_cron_job", () => {
    it("declares required schema fields and zero cost", () => {
      expect(schedule_cron_job.name).toBe("schedule_cron_job");
      expect(schedule_cron_job.parameters.required).toEqual([
        "cronExpression",
        "charterPath",
      ]);
      expect(schedule_cron_job.costUsd).toBe(0);
    });

    it("echoes the schedule in its status string", async () => {
      const r = await schedule_cron_job.execute({
        cronExpression: "0 9 * * *",
        charterPath: "/tmp/c.yaml",
      });
      expect(r.ok).toBe(true);
      expect(String(r.status)).toContain("0 9 * * *");
      expect(String(r.status)).toContain("/tmp/c.yaml");
    });
  });
});
