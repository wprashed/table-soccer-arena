/**
 * Minimal history-based router.
 *
 * `history.pushState` throws a SecurityError inside sandboxed iframes (opaque
 * origin), so navigation degrades gracefully: the URL is updated when the
 * browser allows it, otherwise the app keeps its own path state and (when
 * possible) mirrors it into the hash. The UI therefore never reloads the page
 * just to change view — which is what made login look like a refresh loop.
 */
import { useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
let currentPath: string = safeInitialPath();

function safeInitialPath(): string {
  try {
    const p = window.location.pathname + window.location.search;
    if (p && p !== '/' && !p.startsWith('/index.html')) return p;
    // hash routing fallback (used when pushState is unavailable)
    if (window.location.hash.startsWith('#/')) return window.location.hash.slice(1);
    return '/';
  } catch {
    return '/';
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onPop = () => {
    const next = safeInitialPath();
    if (next !== currentPath) {
      currentPath = next;
      cb();
    }
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onPop);
  };
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === currentPath) return;
  currentPath = to;
  try {
    if (opts.replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
  } catch {
    // opaque-origin iframe: fall back to the hash so the view still changes
    try {
      window.location.hash = '#' + to;
    } catch {
      /* nothing else to do — internal state is already updated */
    }
  }
  emit();
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
}

export function useLocation() {
  return useSyncExternalStore(subscribe, () => currentPath, () => currentPath);
}

export function currentRoute() {
  return currentPath;
}

export function Link({
  to,
  children,
  className,
  onClick,
  title,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const handle = (e: MouseEvent) => {
    // never let the browser perform a full navigation
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} className={className} title={title}>
      {children}
    </a>
  );
}

/** Tiny matcher: '/players/:username' style is supported for one segment. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = path.split('?')[0].replace(/\/$/, '') || '/';
  const a = pattern.split('/');
  const b = p.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
