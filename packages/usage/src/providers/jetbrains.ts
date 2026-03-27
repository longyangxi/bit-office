import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

const JETBRAINS_CONFIG_DIRS_DARWIN = [
  "Library/Application Support/JetBrains",
];
const JETBRAINS_CONFIG_DIRS_LINUX = [
  ".config/JetBrains",
  ".local/share/JetBrains",
];

export class JetBrainsProvider implements UsageProvider {
  readonly id = "jetbrains";
  readonly displayName = "JetBrains AI";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    const dirs =
      process.platform === "darwin"
        ? JETBRAINS_CONFIG_DIRS_DARWIN
        : JETBRAINS_CONFIG_DIRS_LINUX;
    return dirs.some((d) => fs.existsSync(path.join(home, d)));
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
