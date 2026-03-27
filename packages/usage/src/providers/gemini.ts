import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

export class GeminiProvider implements UsageProvider {
  readonly id = "gemini";
  readonly displayName = "Google Gemini";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    if (fs.existsSync(path.join(home, ".config", "gemini"))) return true;
    if (process.env.GEMINI_HOME && fs.existsSync(process.env.GEMINI_HOME)) return true;
    return false;
  }

  async scan(_opts: ScanOptions): Promise<ProviderUsage> {
    return {
      provider: this.id,
      displayName: this.displayName,
      available: true,
      models: [],
      daily: [],
    };
  }
}
