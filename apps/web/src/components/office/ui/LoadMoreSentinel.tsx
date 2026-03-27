import { useRef, useEffect } from "react";

/** Sentinel that triggers loadMore when scrolled into view */
export function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Use the nearest scrollable ancestor as root so the observer detects
    // visibility within the scroll container, not the viewport.
    // Viewport-rooted observers can miss intersection changes inside nested
    // overflow:auto containers (especially WebKit / Tauri).
    const scrollRoot = el.closest<HTMLElement>("[data-scrollbar]") ?? el.parentElement;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) cbRef.current();
    }, { threshold: 0, root: scrollRoot, rootMargin: "100px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} style={{ height: 1, flexShrink: 0 }} />;
}
