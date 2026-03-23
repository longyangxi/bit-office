"use client";

import { useEffect } from "react";
import { registerAblyTransport } from "@/lib/connection";

/**
 * Lazily loads ably-client and registers it as the ably transport.
 * Must be called before any connect() with mode "ably".
 * This hook exists solely to keep ably out of the SSR module graph.
 */
export function useAblyLoader() {
  useEffect(() => {
    let mounted = true;
    import("@/lib/ably-client").then((mod) => {
      if (!mounted) return;
      registerAblyTransport({
        connect: mod.connectToAbly,
        send: mod.sendCommand,
        disconnect: mod.disconnectAbly,
      });
    });
    return () => { mounted = false; };
  }, []);
}
