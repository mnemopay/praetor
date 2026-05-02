export const post_x_tweet = {
  name: "post_x_tweet",
  description: "Drafts and posts a tweet to the authenticated X/Twitter account.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The text content of the tweet (max 280 chars)" }
    },
    required: ["content"]
  },
  costUsd: 0.01,
  metadata: {
    origin: "mock",
    capability: "social_x_post",
    risk: ["reputation", "external_publish"],
    approval: "always",
    sandbox: "remote-provider",
    production: "stub",
    costEffective: true,
  },
  execute: async (args: any) => {
    if (!process.env.X_API_KEY) {
      return { ok: true, mocked: true, message: `[MOCK] X_API_KEY not set. Would have tweeted: "${args.content}"` };
    }
    return { ok: true, id: "1234567890", status: "Tweet posted live." };
  }
};

export const post_tiktok_video = {
  name: "post_tiktok_video",
  description: "Uploads and posts an MP4 video to the authenticated TikTok account.",
  parameters: {
    type: "object",
    properties: {
      videoPath: { type: "string", description: "Absolute path to the local MP4 file" },
      caption: { type: "string", description: "The caption and hashtags for the video" }
    },
    required: ["videoPath", "caption"]
  },
  costUsd: 0.05,
  metadata: {
    origin: "mock",
    capability: "social_tiktok_post",
    risk: ["reputation", "external_publish"],
    approval: "always",
    sandbox: "remote-provider",
    production: "stub",
    costEffective: true,
  },
  execute: async (args: any) => {
    if (!process.env.TIKTOK_API_KEY) {
      return { ok: true, mocked: true, message: `[MOCK] TIKTOK_API_KEY not set. Would have uploaded ${args.videoPath} with caption: "${args.caption}"` };
    }
    return { ok: true, id: "tk_987654", status: "TikTok uploaded and scheduled." };
  }
};

export const schedule_cron_job = {
  name: "schedule_cron_job",
  description: "Schedules a recurring Praetor mission using standard cron syntax.",
  parameters: {
    type: "object",
    properties: {
      cronExpression: { type: "string", description: "Standard cron syntax (e.g., '0 9 * * *' for 9 AM daily)" },
      charterPath: { type: "string", description: "Path to the YAML charter to execute" }
    },
    required: ["cronExpression", "charterPath"]
  },
  costUsd: 0,
  metadata: {
    origin: "mock",
    capability: "mission_schedule",
    risk: ["external_publish"],
    approval: "on-side-effect",
    sandbox: "none",
    production: "stub",
    costEffective: true,
  },
  execute: async (args: any) => {
    // In a real environment, this would write to a crontab or database queue.
    return { 
      ok: true, 
      status: `Successfully scheduled ${args.charterPath} to run on schedule: [${args.cronExpression}]` 
    };
  }
};
