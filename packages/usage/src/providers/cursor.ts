import * as fs from "node:fs";
import * as path from "node:path";
import type { UsageProvider, ScanOptions, ProviderUsage } from "../types.js";

const CURSOR_PATHS_DARWIN = [
  "Library/Application Support/Cursor",
  ".cursor",
];
const CURSOR_PATHS_LINUX = [
  ".config/Cursor",
  ".cursor",
];

export class CursorProvider implements UsageProvider {
  readonly id = "cursor";
  readonly displayName = "Cursor";

  async detect(_opts: ScanOptions): Promise<boolean> {
    const home = _opts.homeDir ?? process.env.HOME ?? "";
    const paths = process.platform === "darwin" ? CURSOR_PATHS_DARWIN : CURSOR_PATHS_LINUX;
    return paths.some((p) => fs.existsSync(path.join(home, p)));
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
