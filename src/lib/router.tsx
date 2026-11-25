/**
 * Minimal history-based router with GitHub Pages subpath and hash support.
 */
import { useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

export function getBasePath(): string {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname;
  // If hosted on GitHub Pages or subfolder, extract first segment
  if (window.location.hostname.endsWith('github.io')) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0 && !segments[0].includes('.')) {
      return '/' + segments[0];
    }
  }
  return '';
}

export function normalizePath(raw: string): string {
  let p = raw.split('?')[0].split('#')[0] || '/';
  const base = getBasePath();
  if (base && p.startsWith(base)) {
    p = p.slice(base.length) || '/';
  }
  // Strip index.html
  p = p.replace(/\/index\.html$/, '') || '/';
  // Strip trailing slash
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p.startsWith('/') ? p : '/' + p;
}

function safeInitialPath(): string {
  try {
    if (typeof window === 'undefined') return '/';
    if (window.location.hash.startsWith('#/')) {
      return normalizePath(window.location.hash.slice(1));
    }
    return normalizePath(window.location.pathname);
  } catch {
    return '/';
  }
}

let currentPath: string = safeInitialPath();

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
  const norm = normalizePath(to);
  if (norm === currentPath) return;
  currentPath = norm;
  try {
    const base = getBasePath();
    const fullUrl = base + norm;
    if (opts.replace) window.history.replaceState({}, '', fullUrl);
    else window.history.pushState({}, '', fullUrl);
  } catch {
    try {
      window.location.hash = '#' + norm;
    } catch {}
  }
  emit();
  window.scrollTo({ top: 0 });
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
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
    navigate(to);
  };
  const base = getBasePath();
  return (
    <a href={base + normalizePath(to)} onClick={handle} className={className} title={title}>
      {children}
    </a>
  );
}

/** Match route pattern: '/players/:username', '/', etc. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const normPattern = normalizePath(pattern);
  const normPath = normalizePath(path);
  if (normPattern === normPath) return {};
  const a = normPattern.split('/').filter(Boolean);
  const b = normPath.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
