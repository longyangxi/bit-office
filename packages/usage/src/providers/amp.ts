import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

export class AmpProvider implements UsageProvider {
  readonly id = "amp";
  readonly displayName = "Amp";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    if (fs.existsSync(path.join(home, ".amp"))) return true;

    try {
      const { execSync } = await import("node:child_process");
      execSync("which amp", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
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
