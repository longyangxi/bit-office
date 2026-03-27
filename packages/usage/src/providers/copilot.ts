import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

const GH_CONFIG_PATHS = [".config/gh", ".config/github-copilot"];

export class CopilotProvider implements UsageProvider {
  readonly id = "copilot";
  readonly displayName = "GitHub Copilot";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    return GH_CONFIG_PATHS.some((p) =>
      fs.existsSync(path.join(home, p)),
    );
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
