/**
 * Storage that never throws.
 *
 * Sandboxed iframes (the in-app preview uses `sandbox="allow-scripts"`, which
 * gives the document an opaque origin) make `localStorage` throw a SecurityError
 * on *access*, not just on write — which used to take the whole app down on the
 * first `setToken` call. Every read/write goes through here instead.
 *
 * Fallback chain: localStorage -> sessionStorage -> in-memory -> window.name.
 * `window.name` survives same-tab reloads even with an opaque origin, so a
 * preview session isn't lost when the frame is re-rendered.
 */
const memory = new Map<string, string>();

function probe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

const hasLocal = probe(() => {
  window.localStorage.setItem('__tsa_probe', '1');
  window.localStorage.removeItem('__tsa_probe');
});

const hasSession = probe(() => {
  window.sessionStorage.setItem('__tsa_probe', '1');
  window.sessionStorage.removeItem('__tsa_probe');
});

const NAME_PREFIX = 'tsa:';

function readName(key: string): string | null {
  try {
    const raw = window.name;
    if (!raw || !raw.startsWith(NAME_PREFIX)) return null;
    const map = JSON.parse(raw.slice(NAME_PREFIX.length)) as Record<string, string>;
    return map[key] ?? null;
  } catch {
    return null;
  }
}

function writeName(key: string, value: string | null) {
  try {
    let map: Record<string, string> = {};
    if (window.name?.startsWith(NAME_PREFIX)) {
      map = JSON.parse(window.name.slice(NAME_PREFIX.length));
    }
    if (value === null) delete map[key];
    else map[key] = value;
    window.name = NAME_PREFIX + JSON.stringify(map);
  } catch {
    /* ignore — memory has it already */
  }
}

export const storage = {
  /** false in sandboxed previews: data lives only for this page view */
  persistent: hasLocal || hasSession,

  get(key: string): string | null {
    if (hasLocal) {
      try {
        const v = window.localStorage.getItem(key);
        if (v !== null) return v;
      } catch {
        /* fall through */
      }
    }
    if (hasSession) {
      try {
        const v = window.sessionStorage.getItem(key);
        if (v !== null) return v;
      } catch {
        /* fall through */
      }
    }
    if (memory.has(key)) return memory.get(key)!;
    return readName(key);
  },

  set(key: string, value: string) {
    memory.set(key, value);
    if (hasLocal) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        /* fall through */
      }
    }
    if (hasSession) {
      try {
        window.sessionStorage.setItem(key, value);
        return;
      } catch {
        /* fall through */
      }
    }
    writeName(key, value);
  },

  remove(key: string) {
    memory.delete(key);
    try {
      if (hasLocal) window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      if (hasSession) window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    writeName(key, null);
  },
};
