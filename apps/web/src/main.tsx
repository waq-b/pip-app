import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
// Reload onto a new version as soon as its service worker takes over (the
// generated worker skips waiting and claims open pages). Without this an
// installed app kept running the old build after a deploy — on iPhone often
// for a relaunch or two (found with sign-in by code, 2026-09-17). A first
// install has no previous controller, so it doesn't reload.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
