/**
 * Material 3 ripple feedback.
 *
 * Installed once at the app root and driven by a single delegated `pointerdown`
 * listener, so any element can opt in with a `data-ripple` attribute instead of
 * every component having to wire up its own handler.
 *
 * A ripple is a circle centred on the actual pointer position that expands to
 * cover the component and fades out, clipped to the component's bounds by the
 * `overflow: hidden` that `.m3-interactive` provides. It is tinted with
 * `currentColor` at 16% opacity, which is how M3 derives the ripple colour from
 * whatever the component's content colour happens to be.
 */

/** Largest ripple diameter we will ever need, used to size the circle. */
const RIPPLE_MAX_MS = 700;

function motionIsReduced(): boolean {
  // The app's own Reduced Motion setting toggles this class on <html>.
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduced-motion')) {
    return true;
  }
  // Honour the OS-level preference too.
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isDisabled(el: Element): boolean {
  if (el.hasAttribute('disabled')) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  // A disabled <button> does not fire pointerdown in most browsers, but a
  // disabled ancestor still can, so walk up to the host we are decorating.
  return false;
}

/**
 * Attach the global ripple listener.
 *
 * @returns a teardown function; safe to call more than once.
 */
export function installRipple(): () => void {
  if (typeof document === 'undefined') return () => {};

  const onPointerDown = (event: PointerEvent) => {
    // Ignore secondary buttons: M3 ripples respond to the primary pointer only.
    if (event.button !== undefined && event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;

    const host = target.closest('[data-ripple]') as HTMLElement | null;
    if (!host) return;
    if (isDisabled(host)) return;
    if (motionIsReduced()) return;

    // Do not stack ripples if the host is still animating a previous one.
    if (host.dataset.rippleActive === '1') return;

    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Diameter must cover the farthest corner from the press point.
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const radius = Math.max(
      Math.hypot(x, y),
      Math.hypot(rect.width - x, y),
      Math.hypot(x, rect.height - y),
      Math.hypot(rect.width - x, rect.height - y),
    );
    const size = radius * 2;

    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.left = `${x - radius}px`;
    span.style.top = `${y - radius}px`;

    host.dataset.rippleActive = '1';
    const clear = () => {
      delete host.dataset.rippleActive;
      span.remove();
    };

    span.addEventListener('animationend', clear, { once: true });
    // Safety net: if animationend never fires (element removed mid-animation,
    // tab throttled), do not leak the node or wedge the host.
    window.setTimeout(clear, RIPPLE_MAX_MS + 200);

    host.appendChild(span);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}

export default installRipple;
