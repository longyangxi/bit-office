import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

export class KiroProvider implements UsageProvider {
  readonly id = "kiro";
  readonly displayName = "Kiro";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    if (fs.existsSync(path.join(home, ".kiro"))) return true;

    try {
      const { execSync } = await import("node:child_process");
      execSync("which kiro-cli", { stdio: "ignore" });
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
