"use client";

import { useEffect } from "react";
import { registerAblyTransport } from "@/lib/connection";

/**
 * Invisible component that lazily loads ably-client and registers it.
 * MUST be loaded via next/dynamic with ssr:false to keep ably out of SSR bundle.
 */
export default function AblyLoader() {
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
  return null;
}
