// packages/orchestrator/src/plugin-registry.ts

export type PluginSlot = "agent" | "workspace" | "notifier";

export interface PluginManifest {
  name: string;
  slot: PluginSlot;
}

export interface PluginRegistry {
  /** Register a plugin instance under a slot and name */
  register<T>(slot: PluginSlot, name: string, instance: T): void;
  /** Get a specific plugin by slot and name */
  get<T>(slot: PluginSlot, name: string): T | null;
  /** Get the first registered plugin for a slot (default) */
  getDefault<T>(slot: PluginSlot): T | null;
  /** List all registered manifests for a slot */
  list(slot: PluginSlot): PluginManifest[];
}

function makeKey(slot: PluginSlot, name: string): string {
  return `${slot}:${name}`;
}

/**
 * Create a lightweight plugin registry.
 * No dynamic discovery — just register + get.
 */
export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<string, { manifest: PluginManifest; instance: unknown }>();
  /** Track insertion order per slot for getDefault */
  const firstPerSlot = new Map<PluginSlot, string>();

  return {
    register<T>(slot: PluginSlot, name: string, instance: T): void {
      const key = makeKey(slot, name);
      plugins.set(key, { manifest: { name, slot }, instance });
      if (!firstPerSlot.has(slot)) {
        firstPerSlot.set(slot, key);
      }
    },

    get<T>(slot: PluginSlot, name: string): T | null {
      const entry = plugins.get(makeKey(slot, name));
      return entry ? (entry.instance as T) : null;
    },

    getDefault<T>(slot: PluginSlot): T | null {
      const key = firstPerSlot.get(slot);
      if (!key) return null;
      const entry = plugins.get(key);
      return entry ? (entry.instance as T) : null;
    },

    list(slot: PluginSlot): PluginManifest[] {
      const result: PluginManifest[] = [];
      for (const [key, entry] of plugins) {
        if (key.startsWith(`${slot}:`)) {
          result.push(entry.manifest);
        }
      }
      return result;
    },
  };
}
