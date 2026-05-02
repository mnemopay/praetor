import { mouse, keyboard, screen, Point, Button, Key } from "@nut-tree/nut-js";
import Jimp from "jimp";

export interface PraetorComputerSessionOptions {
  auditSink?: { record: (type: string, data: Record<string, unknown>) => void };
}

export class PraetorComputerSession {
  constructor(private readonly opts: PraetorComputerSessionOptions = {}) {
    mouse.config.mouseSpeed = 1000;
  }

  async screenshot(): Promise<{ base64: string; width: number; height: number }> {
    this.opts.auditSink?.record("computer.screenshot", {});
    const img = await screen.grab();
    // nut-js returns RGB/BGR buffer. We can wrap it in Jimp to get a PNG base64.
    // However, to keep it simple and robust, we can just save and read.
    const path = await screen.capture("praetor_screen.png");
    // Actually, capture saves to disk. We can read it and return base64.
    const fs = await import("fs/promises");
    const buf = await fs.readFile(path);
    const base64 = `data:image/png;base64,${buf.toString("base64")}`;
    await fs.unlink(path); // clean up
    return { base64, width: img.width, height: img.height };
  }

  async redact(base64Png: string, regions: { x: number; y: number; w: number; h: number }[]): Promise<string> {
    this.opts.auditSink?.record("computer.redact", { regions });
    const raw = base64Png.replace(/^data:image\/png;base64,/, "");
    const img = await Jimp.read(Buffer.from(raw, "base64"));
    for (const r of regions) {
      img.scan(r.x, r.y, r.w, r.h, function (x: number, y: number, idx: number) {
        this.bitmap.data[idx + 0] = 0; // R
        this.bitmap.data[idx + 1] = 0; // G
        this.bitmap.data[idx + 2] = 0; // B
        this.bitmap.data[idx + 3] = 255; // Alpha
      });
    }
    return await img.getBase64Async(Jimp.MIME_PNG);
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<void> {
    this.opts.auditSink?.record("computer.click", { x, y, button });
    await mouse.setPosition(new Point(x, y));
    if (button === "left") await mouse.leftClick();
    if (button === "right") await mouse.rightClick();
    if (button === "middle") await mouse.click(Button.MIDDLE);
  }

  async type(text: string): Promise<void> {
    this.opts.auditSink?.record("computer.type", { length: text.length });
    await keyboard.type(text);
  }

  async scroll(amount: number, direction: "up" | "down" = "down"): Promise<void> {
    this.opts.auditSink?.record("computer.scroll", { amount, direction });
    if (direction === "down") await mouse.scrollDown(amount);
    if (direction === "up") await mouse.scrollUp(amount);
  }

  async hotkey(keys: string[]): Promise<void> {
    this.opts.auditSink?.record("computer.hotkey", { keys });
    const mapped = keys.map(k => {
      const keyStr = k.toUpperCase() as keyof typeof Key;
      return Key[keyStr];
    }).filter(k => k !== undefined);
    
    if (mapped.length > 0) {
      await keyboard.pressKey(...mapped);
      await keyboard.releaseKey(...mapped);
    }
  }
}
