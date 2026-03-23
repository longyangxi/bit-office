import type * as AblyTypes from "ably";
import { GatewayEventSchema } from "@office/shared";
import { useOfficeStore } from "@/store/office-store";
import { getGatewayHttpUrl } from "@/lib/storage";

let Ably: typeof import("ably") | null = null;
let client: AblyTypes.Realtime | null = null;
let commandsChannel: AblyTypes.RealtimeChannel | null = null;

export async function connectToAbly(machineId: string, sessionToken?: string) {
  if (!Ably) Ably = await import("ably");
  client = new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        const baseUrl = getGatewayHttpUrl();
        const res = await fetch(`${baseUrl}/ably/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId, sessionToken }),
        });
        if (!res.ok) throw new Error("Token request failed");
        const tokenRequest = await res.json();
        callback(null, tokenRequest);
      } catch (err) {
        callback(err instanceof Error ? err.message : String(err), null);
      }
    },
  });

  client.connection.on("connected", () => {
    useOfficeStore.getState().setConnected(true);
    const cmdCh = client!.channels.get(`machine:${machineId}:commands`);
    cmdCh.publish("PING", { type: "PING" });
  });

  client.connection.on("disconnected", () => {
    useOfficeStore.getState().setConnected(false);
  });

  const eventsChannel = client.channels.get(`machine:${machineId}:events`);
  eventsChannel.subscribe((msg: AblyTypes.Message) => {
    try {
      const event = GatewayEventSchema.parse(msg.data);
      useOfficeStore.getState().handleEvent(event);
    } catch (err) {
      console.error("[Web] Invalid event:", err);
    }
  });

  commandsChannel = client.channels.get(`machine:${machineId}:commands`);
}

export function sendCommand(command: Record<string, unknown>) {
  if (!commandsChannel) throw new Error("Not connected");
  console.log("[Web] Sending command:", command.type, command);
  commandsChannel.publish(command.type as string, command).then(
    () => console.log("[Web] Command published OK"),
    (err) => console.error("[Web] Command publish failed:", err),
  );
}

export function disconnectAbly() {
  if (!client) return;
  const state = client.connection.state;
  if (state === "connected" || state === "disconnected" || state === "suspended") {
    client.close();
  } else if (state === "connecting" || state === "initialized") {
    client.connection.once("connected", () => client?.close());
    client.connection.once("failed", () => { /* already dead */ });
  }
  client = null;
  commandsChannel = null;
}
