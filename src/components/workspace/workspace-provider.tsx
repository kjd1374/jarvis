"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  commitWorkspace,
  readWorkspace,
  readCloudLocal,
  setStorageAccount,
} from "@/lib/workspace/storage";
import { emptyWorkspace, type WorkspaceData } from "@/lib/workspace/types";
import {
  accountStatus,
  accountAction,
  CloudRequestError,
  type AccountStatus,
} from "@/lib/cloud/client";
import {
  hydrateCloud,
  flushCloud,
  CloudConflict,
  resolveCloudConflict,
} from "@/lib/cloud/persistence";

type Workspace = {
  data: WorkspaceData;
  ready: boolean;
  saving: boolean;
  error: string | null;
  account: AccountStatus | null;
  syncStatus: "local" | "waiting" | "saving" | "saved" | "error" | "conflict";
  conflict: CloudConflict | null;
  retryLoad: () => void;
  retryCloud: (recheckConflict?: boolean) => Promise<void>;
  resolveConflict: (preferLocal: boolean) => Promise<void>;
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
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [syncStatus, setSyncStatus] =
    useState<Workspace["syncStatus"]>("local");
  const [conflict, setConflict] = useState<CloudConflict | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const accountRef = useRef<AccountStatus | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);
  const syncing = useRef(false);
  const conflictRef = useRef<CloudConflict | null>(null);

  const retryCloud = useCallback(async function flush(recheckConflict = false): Promise<void> {
    const accountId = accountRef.current?.accountId;
    if (!accountId || !accountRef.current?.authenticated || syncing.current || conflictRef.current && !recheckConflict)
      return;
    if (recheckConflict) conflictRef.current = null;
    syncing.current = true;
    setSyncStatus("saving");
    let failed = false;
    try {
      const pending = await readCloudLocal(accountId);
      if (!Object.values(pending.sync.dirty).some((n) => n !== null)) {
        const value = await hydrateCloud(accountId);
        if (accountRef.current?.accountId === accountId) setData(value);
      }
      await flushCloud(accountId);
      const saved = await readCloudLocal(accountId);
      if (accountRef.current?.accountId === accountId) {
        generation.current++;
        setData(saved.data);
        setSyncStatus("saved");
        setError(null);
        conflictRef.current = null;
        setConflict(null);
      }
    } catch (e) {
      failed = true;
      if (accountRef.current?.accountId !== accountId) return;
      if (e instanceof CloudRequestError && [401, 403].includes(e.status)) {
        setReady(false);
        setData(emptyWorkspace());
        setLoadAttempt((n) => n + 1);
      }
      if (e instanceof CloudConflict) {
        conflictRef.current = e;
        setConflict(e);
        setSyncStatus("conflict");
      } else setSyncStatus("error");
      setError(
        e instanceof Error
          ? e.message
          : "서버에 저장하지 못했습니다. 이 기기에 보관하고 있습니다.",
      );
    } finally {
      syncing.current = false;
      if (!failed && accountRef.current?.accountId === accountId) {
        const value = await readCloudLocal(accountId).catch(() => null);
        if (value && Object.values(value.sync.dirty).some((n) => n !== null))
          void flush();
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const requestGeneration = ++generation.current;
      const current = () => active && requestGeneration === generation.current;
      try {
        let status = await accountStatus();
        if (!current()) return;
        if (accountRef.current?.accountId !== status.accountId) {
          conflictRef.current = null;
          setConflict(null);
        }
        accountRef.current = status;
        setAccount(status);
        if (
          status.enabled &&
          status.configured &&
          !status.authenticated &&
          !status.pairingCode
        ) {
          await accountAction("device");
          status = await accountStatus();
        }
        if (!current()) return;
        accountRef.current = status;
        setAccount(status);
        if (status.enabled && (!status.authenticated || !status.accountId)) {
          conflictRef.current = null;
          setConflict(null);
          setStorageAccount(null);
          setData(emptyWorkspace());
          setReady(false);
          setSyncStatus("waiting");
          setError(
            status.pairingCode
              ? "처음 사용하는 기기입니다. 설정에서 기기 확인 번호를 확인해주세요."
              : "서버와 이 기기의 연결 설정이 필요합니다.",
          );
          return;
        }
        const accountId = status.enabled ? status.accountId : undefined;
        setStorageAccount(accountId ?? null);
        const value = accountId
          ? await hydrateCloud(accountId)
          : await readWorkspace();
        if (!current()) return;
        setData(value);
        setReady(true);
        if (!conflictRef.current) setError(null);
        if (accountId) {
          const local = await readCloudLocal(accountId);
          if (!current()) return;
          const dirty = Object.values(local.sync.dirty).some((n) => n !== null);
          if (!conflictRef.current) {
            setSyncStatus(dirty ? "waiting" : "saved");
            if (dirty) void retryCloud();
          }
        } else setSyncStatus("local");
      } catch (e) {
        if (!current()) return;
        const accountId = accountRef.current?.accountId;
        if (accountRef.current?.authenticated && accountId) {
          const local = await readCloudLocal(accountId).catch(() => null);
          if (!current()) return;
          if (local?.hasSnapshot) {
            setData(local.data);
            setReady(true);
            setSyncStatus("error");
          }
        }
        setError(
          e instanceof Error ? e.message : "저장 공간을 사용할 수 없습니다.",
        );
      }
    }
    void refresh();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("jarvis-workspace");
      channel.current.onmessage = () => void refresh();
    }
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const online = () => setLoadAttempt((n) => n + 1);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    return () => {
      active = false;
      channel.current?.close();
      channel.current = null;
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
    };
  }, [loadAttempt, retryCloud]);

  const documentPending = data.documents.some(d => d.sheet?.questions.some(q => q.status === "queued" || q.status === "running"));
  const planningPending = data.projects.some(p => p.planning?.turns.some(t => t.status === "queued" || t.status === "running"));
  const releasePending = data.projects.some(p => p.release && ["queued", "running"].includes(p.release.status));
  const setupPending = data.projects.some(project => project.setup && ["queued", "running"].includes(project.setup.status));
  const workPending = data.projects.some(project => project.automation?.turns.some(turn => ["queued", "running"].includes(turn.status)));
  const monitoringActive = releasePending || setupPending || planningPending || documentPending || data.documents.some(d => d.sheet) || data.services.some(s => s.monitoring?.enabled) || data.projects.some(p => p.automation?.turns.some(t => t.status === "queued" || t.status === "running"));
  useEffect(() => {
    if (!account?.authenticated || !monitoringActive) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !conflictRef.current) setLoadAttempt(n => n + 1);
    }, releasePending || documentPending || planningPending || workPending || setupPending ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [account?.authenticated, monitoringActive, documentPending, planningPending, workPending, setupPending, releasePending]);

  function retryLoad() {
    if (!conflictRef.current) setError(null);
    setLoadAttempt((n) => n + 1);
  }
  async function resolveConflict(preferLocal: boolean) {
    const accountId = accountRef.current?.accountId;
    if (!accountId || !conflict) return;
    if (syncing.current) throw new Error("저장이 진행 중입니다. 잠시 후 다시 시도해주세요.");
    syncing.current = true;
    try {
      const value = await resolveCloudConflict(
        accountId,
        conflict,
        preferLocal,
      );
      if (accountRef.current?.accountId !== accountId) return;
      generation.current++;
      setData(value);
      conflictRef.current = null;
      setConflict(null);
      setError(null);
    } catch (e) {
      if (accountRef.current?.accountId !== accountId) return;
      if (e instanceof CloudConflict) {
        conflictRef.current = e;
        setConflict(e);
        setSyncStatus("conflict");
      }
      setError(
        e instanceof Error ? e.message : "병합 내용을 다시 확인해주세요.",
      );
      throw e;
    } finally { syncing.current = false; }
    await retryCloud();
  }
  async function mutate(
    transform: (data: WorkspaceData) => WorkspaceData,
    files: { id: string; blob: Blob; preventOverwrite?: boolean }[] = [],
  ) {
    if (!ready)
      throw new Error("저장 공간을 준비 중입니다. 잠시 후 다시 시도해주세요.");
    const accountId = accountRef.current?.accountId;
    setPending((n) => n + 1);
    try {
      const value = await commitWorkspace(
        transform,
        files,
        accountId ? { accountId, trackCloud: true } : undefined,
      );
      if (accountRef.current?.accountId !== accountId) return;
      generation.current++;
      setData(value);
      if (accountId) {
        setSyncStatus("waiting");
        void retryCloud();
      } else setError(null);
      channel.current?.postMessage("updated");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "변경 내용을 저장하지 못했습니다.",
      );
      throw e;
    } finally {
      setPending((n) => n - 1);
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        ready,
        saving: pending > 0,
        error,
        account,
        syncStatus,
        conflict,
        retryCloud,
        resolveConflict,
        mutate,
        retryLoad,
      }}
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
