/**
 * Progressive Web App (PWA) utilities:
 * - Service worker registration with update detection
 * - Install prompt detection (beforeinstallprompt)
 * - Standalone display-mode awareness
 */

import { useState, useEffect } from 'react';

let deferredPrompt: any = null;

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    // Determine base path for sw.js (e.g. for GitHub Pages subfolder /table-soccer-arena/)
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        // Check for updates periodically
        reg.addEventListener('updatefound', () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New Table Soccer Arena update available.');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa:installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa:installed'));
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

export async function promptPwaInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

export function usePwa() {
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  const [standalone, setStandalone] = useState(isStandalone());

  useEffect(() => {
    const onInstallable = () => setCanInstall(true);
    const onInstalled = () => {
      setCanInstall(false);
      setStandalone(true);
    };

    window.addEventListener('pwa:installable', onInstallable);
    window.addEventListener('pwa:installed', onInstalled);

    return () => {
      window.removeEventListener('pwa:installable', onInstallable);
      window.removeEventListener('pwa:installed', onInstalled);
    };
  }, []);

  return {
    canInstall,
    isStandalone: standalone,
    install: promptPwaInstall,
  };
}
