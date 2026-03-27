import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

export class OpenRouterProvider implements UsageProvider {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";

  async detect(_opts: ScanOptions): Promise<boolean> {
    if (process.env.OPENROUTER_API_KEY) return true;
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    return fs.existsSync(path.join(home, ".config", "openrouter"));
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
