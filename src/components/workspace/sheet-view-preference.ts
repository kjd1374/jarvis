"use client";

import { useCallback, useSyncExternalStore } from "react";

const eventName = "jarvis-sheet-view-change";
// View preferences contain only dimensions/visibility, never cells or credentials.
const fallback = new Map<string, string>();
const serverSnapshot = () => "";

export function useSheetViewPreference(key: string) {
  const subscribe = useCallback((notify: () => void) => {
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
      if (event instanceof CustomEvent && event.detail !== key) return;
      notify();
    };
    window.addEventListener("storage", changed);
    window.addEventListener(eventName, changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener(eventName, changed); };
  }, [key]);
  const read = useCallback(() => {
    if (fallback.has(key)) return fallback.get(key)!;
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  }, [key]);
  const value = useSyncExternalStore(subscribe, read, serverSnapshot);
  const save = useCallback((next: string) => {
    let persisted = true;
    try { localStorage.setItem(key, next); fallback.delete(key); }
    catch { fallback.set(key, next); persisted = false; }
    window.dispatchEvent(new CustomEvent(eventName, { detail: key }));
    return persisted;
  }, [key]);
  return [value, save] as const;
}
