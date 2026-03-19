/**
 * useScrollAnchor — unified scroll-to-bottom controller
 *
 * Replaces 6 separate scroll mechanisms (useLayoutEffect, ResizeObserver,
 * MutationObserver, visibilitychange, focus, scrollFrozen thaw) with a
 * single hook that funnels all scroll requests through ONE rAF executor.
 *
 * Usage:
 *   const endRef = useScrollAnchor({ msgCount, frozen, key });
 *   // place <div ref={endRef} /> at the bottom of the scroll container
 *
 * The hook resolves the container as endRef.parentElement.
 *
 * NOTE: Uses endRef.scrollIntoView() instead of container.scrollTop = scrollHeight
 * because WebKit (Tauri) can return stale scrollHeight in useLayoutEffect before
 * layout recalculation. scrollIntoView delegates positioning to the engine itself.
 */
import { useRef, useEffect, useLayoutEffect } from "react";

export interface ScrollAnchorOptions {
  /** Number of messages — triggers synchronous scroll on change */
  msgCount: number;
  /** When true, all scroll logic is suspended (e.g. during CSS transition) */
  frozen?: boolean;
  /** Changing this tears down and rebuilds all observers (e.g. agentId) */
  key?: string;
  /** Force pinned=true from outside (e.g. when prompt clears after send) */
  forcePin?: boolean;
}

export function useScrollAnchor(opts: ScrollAnchorOptions) {
  const { msgCount, frozen = false, key = "", forcePin = false } = opts;

  const endRef = useRef<HTMLDivElement>(null);

  // ── Core state ──
  const pinnedRef = useRef(true);   // true = auto-follow (stick to bottom)
  const resizingRef = useRef(false); // true while ResizeObserver callback is in-flight
  const rafRef = useRef(0);          // single shared rAF id — at most 1 pending frame

  // ── Helpers ──
  const getContainer = () => endRef.current?.parentElement ?? null;

  /**
   * Scroll the end sentinel into view. This is more reliable than
   * `container.scrollTop = container.scrollHeight` because WebKit can return
   * stale scrollHeight during intermediate layout states (e.g. inside
   * useLayoutEffect after DOM commit but before full reflow).
   *
   * scrollIntoView lets the browser engine compute the correct position
   * internally, avoiding the stale-value problem entirely.
   */
  const scrollToBottom = () => {
    const el = endRef.current;
    if (!el) return;
    // Use scrollIntoView on the sentinel — block:"end" aligns it to the
    // bottom of the scroll container without affecting outer scroll.
    el.scrollIntoView({ block: "end", behavior: "instant" as ScrollBehavior });
    pinnedRef.current = true;
  };

  /**
   * requestScroll — the single entry point for all "please scroll to bottom"
   * requests. Coalesces multiple calls into one rAF. No-ops if frozen or
   * not pinned.
   */
  const requestScroll = () => {
    if (frozen || !pinnedRef.current) return;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (pinnedRef.current && !frozen) {
        scrollToBottom();
      }
    });
  };

  // ── forcePin from parent (e.g. prompt cleared after send) ──
  // IMPORTANT: must be useLayoutEffect so it runs BEFORE the msgCount
  // useLayoutEffect in the same commit. React fires layout effects
  // bottom-up in child→parent order and in declaration order within
  // the same component, so this runs first.
  const prevForcePinRef = useRef(forcePin);
  useLayoutEffect(() => {
    if (forcePin && !prevForcePinRef.current) {
      pinnedRef.current = true;
    }
    prevForcePinRef.current = forcePin;
  }, [forcePin]);

  // ── 1. Synchronous scroll on message count change ──
  // useLayoutEffect runs after DOM commit but before paint, so the user
  // never sees a frame without the scroll applied.
  useLayoutEffect(() => {
    if (frozen) return;
    if (pinnedRef.current) {
      scrollToBottom();
    }
  }, [key, msgCount, frozen]);

  // ── 2. Scroll position tracking (is user pinned to bottom?) ──
  // Debounced to next frame so we only read dimensions after layout settles.
  // Skipped during resize to avoid false negatives from intermediate heights.
  useEffect(() => {
    const container = getContainer();
    if (!container) return;
    let checkRaf = 0;
    const onScroll = () => {
      if (resizingRef.current || frozen) return;
      cancelAnimationFrame(checkRaf);
      checkRaf = requestAnimationFrame(() => {
        pinnedRef.current =
          container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(checkRaf);
    };
  }, [key, frozen]);

  // ── 3. ResizeObserver (container size changes: textarea grow, pane resize) ──
  useEffect(() => {
    const container = getContainer();
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (frozen) return;
      resizingRef.current = true;
      requestScroll();
      // Clear resizing flag after scroll is applied (next frame)
      // We piggyback on the same rAF — if requestScroll already scheduled one,
      // we just schedule a follow-up to clear the flag.
      requestAnimationFrame(() => {
        resizingRef.current = false;
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      resizingRef.current = false;
    };
  }, [key, frozen]);

  // ── 4. MutationObserver (streaming text, DOM subtree changes) ──
  useEffect(() => {
    const container = getContainer();
    if (!container) return;
    const observer = new MutationObserver(() => {
      if (frozen) return;
      requestScroll();
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [key, frozen]);

  // ── 5. Visibility restore (Tauri minimize→restore, tab switch) ──
  // Uses double-rAF so the browser has a full frame to recalculate layout
  // before we scroll.
  useEffect(() => {
    const reanchor = () => {
      if (frozen || !pinnedRef.current) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (pinnedRef.current && !frozen) {
            scrollToBottom();
          }
        });
      });
    };

    const onVisChange = () => {
      if (document.visibilityState === "visible") reanchor();
    };
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("focus", reanchor);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("focus", reanchor);
    };
  }, [key, frozen]);

  // ── 6. Frozen thaw (scrollFrozen true→false after CSS transition) ──
  const prevFrozenRef = useRef(frozen);
  useEffect(() => {
    const wasFrozen = prevFrozenRef.current;
    prevFrozenRef.current = frozen;
    if (wasFrozen && !frozen) {
      pinnedRef.current = true;
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [frozen]);

  // ── Cleanup pending rAF on unmount ──
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, []);

  return endRef;
}
