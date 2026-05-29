"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker and handles update notifications.
 * Rendered once in the root layout; has no visible output.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Check for updates every time the page becomes visible
        const handleVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            registration.update();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // When a new SW is waiting, reload to activate it
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New content is available; reload once to activate
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Reload when the controller changes (new SW activated)
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        return () => {
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
        };
      } catch (err) {
        console.warn("[PWA] Service worker registration failed:", err);
      }
    };

    // Defer registration until after the page has loaded
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW, { once: true });
    }
  }, []);

  return null;
}
