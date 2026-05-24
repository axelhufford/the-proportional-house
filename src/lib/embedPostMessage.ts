import { useEffect, useRef } from 'react';

/**
 * postMessage protocol for embedded iframes.
 *
 * The embed iframe measures its own content height and posts it to the
 * parent window. The parent listens for messages with `type` ==
 * 'proportional-house:resize' and updates its iframe's height attribute.
 * Host pages can copy the snippet documented on the Methodology page.
 *
 * The `embed` field gives host pages a way to disambiguate when they have
 * multiple Proportional House embeds on the same page (e.g. "national" +
 * "state/CA"). The path of the embed is included so the parent can update
 * the right iframe.
 */
export interface EmbedResizeMessage {
  type: 'proportional-house:resize';
  embed: string;
  height: number;
}

/**
 * Hook: observe the supplied container's height and post it to the parent
 * window whenever it changes. No-ops if not inside an iframe.
 */
export function useEmbedHeightSync(containerRef: React.RefObject<HTMLElement | null>): void {
  const lastHeightRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Only post when actually inside an iframe — outside of one this would
    // post to itself, which is harmless but spammy.
    if (typeof window === 'undefined' || window.parent === window) return;

    const post = (height: number) => {
      // Skip identical heights to avoid spamming the parent with no-ops.
      if (Math.abs(height - lastHeightRef.current) < 1) return;
      lastHeightRef.current = height;
      const msg: EmbedResizeMessage = {
        type: 'proportional-house:resize',
        embed: window.location.pathname,
        height: Math.ceil(height),
      };
      // Wildcard target: we don't know which origin embedded us. The message
      // payload contains no secrets — it's just a height number — so this
      // is safe. Hosts should filter on `event.data.type` and origin if
      // they need to.
      window.parent.postMessage(msg, '*');
    };

    // Initial post.
    post(el.getBoundingClientRect().height);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        post(h);
      }
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [containerRef]);
}
