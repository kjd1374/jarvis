"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { commitWorkspace, readWorkspace } from "@/lib/workspace/storage";
import { emptyWorkspace, type WorkspaceData } from "@/lib/workspace/types";

type Workspace = {
  data: WorkspaceData;
  ready: boolean;
  saving: boolean;
  error: string | null;
  retryLoad: () => void;
  mutate: (
    transform: (data: WorkspaceData) => WorkspaceData,
    files?: { id: string; blob: Blob; preventOverwrite?: boolean }[],
  ) => Promise<void>;
};
const Context = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const requestGeneration = ++generation.current;
      try {
        const value = await readWorkspace();
        if (active && requestGeneration === generation.current) {
          setData(value);
          setReady(true);
          setError(null);
        }
      } catch (error) {
        if (active && requestGeneration === generation.current)
          setError(
            error instanceof Error
              ? error.message
              : "저장 공간을 사용할 수 없습니다.",
          );
      }
    }
    void refresh();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("jarvis-workspace");
      channel.current.onmessage = () => void refresh();
    }
    function visible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      channel.current?.close();
      channel.current = null;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadAttempt]);

  function retryLoad() {
    setError(null);
    setLoadAttempt((attempt) => attempt + 1);
  }

  async function mutate(
    transform: (data: WorkspaceData) => WorkspaceData,
    files: { id: string; blob: Blob; preventOverwrite?: boolean }[] = [],
  ) {
    if (!ready)
      throw new Error("저장 공간을 준비 중입니다. 잠시 후 다시 시도해주세요.");
    setPending((count) => count + 1);
    try {
      const value = await commitWorkspace(transform, files);
      generation.current++;
      setData(value);
      setError(null);
      channel.current?.postMessage("updated");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "변경 내용을 저장하지 못했습니다.",
      );
      throw error;
    } finally {
      setPending((count) => count - 1);
    }
  }

  return (
    <Context.Provider
      value={{ data, ready, saving: pending > 0, error, mutate, retryLoad }}
    >
      {children}
    </Context.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkspaceProvider is required");
  return value;
}
