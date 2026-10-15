"use client";
import { useSyncExternalStore } from "react";
let time = 0;
function subscribe(notify: () => void) {
  const update = () => {
    time = Date.now();
    notify();
  };
  update();
  const timer = window.setInterval(update, 60_000);
  window.addEventListener("focus", update);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", update);
  };
}
export function useWorkspaceClock() {
  return useSyncExternalStore(
    subscribe,
    () => time,
    () => 0,
  );
}
