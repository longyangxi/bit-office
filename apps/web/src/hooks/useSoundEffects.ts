import { useEffect, useRef } from "react";
import { useOfficeStore } from "@/store/office-store";
import { playSound } from "@/lib/sound-manager";

/**
 * Subscribe to office-store state changes and play sounds for key events.
 * Compares previous vs current agent statuses each tick.
 */
export function useSoundEffects(enabled: boolean) {
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const lastDelegationId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const unsub = useOfficeStore.subscribe((state) => {
      const prev = prevStatuses.current;
      const next = new Map<string, string>();

      for (const [id, agent] of state.agents) {
        const status = agent.status;
        next.set(id, status);

        const prevStatus = prev.get(id);
        if (prevStatus === status) continue; // no change

        // New agent just appeared — skip initial sound
        if (prevStatus === undefined) continue;

        switch (status) {
          case "working":
            if (prevStatus !== "working") playSound("taskStart");
            break;
          case "done":
            playSound("taskDone");
            break;
          case "error":
            playSound("taskFailed");
            break;
          case "waiting_approval":
            playSound("approval");
            break;
        }
      }

      // Check for new team messages (delegation events)
      const teamMsgs = state.teamMessages;
      if (teamMsgs.length > 0) {
        const latest = teamMsgs[teamMsgs.length - 1];
        if (
          latest.messageType === "delegation" &&
          latest.id !== lastDelegationId.current &&
          Date.now() - latest.timestamp < 2000
        ) {
          lastDelegationId.current = latest.id;
          playSound("delegation");
        }
      }

      prevStatuses.current = next;
    });

    return unsub;
  }, [enabled]);
}
