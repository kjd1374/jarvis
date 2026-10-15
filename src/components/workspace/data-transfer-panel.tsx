"use client";
import { useEffect, useRef, useState } from "react";
import {
  createBackup,
  parseBackup,
  backupFiles,
  type Backup,
} from "@/lib/workspace/backup";
import { mergeWorkspace, scopeWorkspace } from "@/lib/workspace/transfer";
import {
  readFile,
  readLegacyWorkspace,
  readLegacyFile,
} from "@/lib/workspace/storage";
import {
  cloudStatus,
  pullCloud,
  pushCloud,
  uploadCloudFile,
} from "@/lib/cloud/client";
import { spaceLabels, type WorkspaceData } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import styles from "./studio.module.css";

export function DataTransferPanel() {
  const { data, ready, saving, mutate, account } = useWorkspace();
  const space = data.activeSpace;
  const [files, setFiles] = useState(true);
  const [scope, setScope] = useState<"all" | "current">("current");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<Backup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cloud, setCloud] = useState<{
    available: boolean;
    reason?: string;
    accountId?: string;
  }>({ available: false, reason: "연결 상태 확인 중" });
  const [remote, setRemote] = useState<{
    data: WorkspaceData;
    revision: number;
  } | null>(null);
  const [revision, setRevision] = useState<{
    space: string;
    value: number;
  } | null>(null);
  const [useRemote, setUseRemote] = useState(false);
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    void cloudStatus()
      .then((value) => {
        if (active) setCloud(value);
      })
      .catch((e) => {
        if (active) setCloud({ available: false, reason: e.message });
      });
    return () => {
      active = false;
    };
  }, []);
  const safelyPreview = (incoming: WorkspaceData) => {
    try {
      return mergeWorkspace(data, incoming);
    } catch {
      return null;
    }
  };
  const preview = backup ? safelyPreview(backup.data) : null;
  const remotePreview =
    remote && remote.data.activeSpace === space
      ? safelyPreview(remote.data)
      : null;
  async function run(work: () => Promise<void>) {
    if (working.current || saving) return;
    working.current = true;
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "처리하지 못했습니다. 기존 기록은 유지됩니다.",
      );
    } finally {
      working.current = false;
      setPending(false);
    }
  }
  async function exportBackup() {
    await run(async () => {
      const value = await createBackup(
        scope === "current" ? scopeWorkspace(data, space) : data,
        files,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `jarvis-backup-${scope === "all" ? "all" : space}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice(
        "백업을 내보냈습니다. 파일에는 선택한 영역의 메모·대화가 포함됩니다.",
      );
    });
  }
  async function importBackup(file: File) {
    await run(async () => {
      if (file.size > 64 * 1024 * 1024)
        throw new Error("백업 파일은 64 MB 이내여야 합니다.");
      const value = parseBackup(await file.text());
      mergeWorkspace(data, value.data);
      setBackup(value);
      setConfirmed(false);
    });
  }
  async function applyBackup() {
    if (!backup || !confirmed) return;
    await run(async () => {
      const originalFiles = await backupFiles(backup);
      const counts = mergeWorkspace(data, backup.data);
      await mutate(
        (current) => mergeWorkspace(current, backup.data).data,
        originalFiles,
      );
      setNotice(
        `${counts.added}개 항목을 병합했습니다. 충돌 ${counts.conflicts}개는 현재 기록을 유지했습니다. 원본 포함 여부: ${backup.includesFiles ? "포함" : "제외"}`,
      );
      setBackup(null);
      if (input.current) input.current.value = "";
    });
  }
  async function reviewServer() {
    await run(async () => {
      const result = await pullCloud(space);
      setRemote(result);
      setCloudConfirmed(false);
      setUseRemote(false);
    });
  }
  async function mergeServer() {
    if (!remote || !cloudConfirmed || remote.data.activeSpace !== space) return;
    await run(async () => {
      await mutate(
        (current) => mergeWorkspace(current, remote.data, useRemote).data,
      );
      setRevision({ space, value: remote.revision });
      setRemote(null);
      setNotice(
        "서버 자료를 검토해 이 기기에 병합했습니다. 기존에만 있던 항목은 유지됩니다.",
      );
    });
  }
  async function publish() {
    if (!revision || revision.space !== space) return;
    await run(async () => {
      const result = await pushCloud(space, data, revision.value);
      setRevision({ space, value: result.revision });
      let missing = 0;
      for (const document of data.documents.filter(
        (d) => d.space === space && !d.sourceUrl,
      )) {
        try {
          await uploadCloudFile(
            space,
            document.id,
            await readFile(document.id),
          );
        } catch {
          missing++;
        }
      }
      setNotice(
        missing
          ? `업무 기록은 서버에 저장했습니다. 원본 ${missing}개는 전송하지 못해 이 기기의 파일 백업을 확인해야 합니다.`
          : "이 영역의 업무 기록과 이 기기에 있는 파일을 서버에 보관했습니다.",
      );
    });
  }
  return (
    <>
      <section
        className={styles.settingsCard}
        aria-label="기존 데이터 내보내기와 이관"
      >
        <h2>백업 · 다른 주소로 이관</h2>
        <p>
          기존 기록을 삭제하거나 조용히 덮어쓰지 않습니다. 가져오기는 먼저
          내용을 확인한 뒤 새 항목만 병합하고, 같은 ID의 다른 내용은 현재 기록을
          유지합니다.
        </p>
        <div className={styles.transferOptions}>
          <label>
            내보낼 범위
            <select
              aria-label="백업 범위"
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "current")}
            >
              <option value="all">회사·개인 전체(명시적 선택)</option>
              <option value="current">현재 {spaceLabels[space]} 영역만</option>
            </select>
          </label>
          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={files}
              onChange={(e) => setFiles(e.target.checked)}
            />{" "}
            파일 원본 포함
          </label>
        </div>
        <div className={styles.projectActions}>
          {account?.authenticated && (
            <button
              className={styles.secondaryButton}
              disabled={!ready || pending || saving}
              onClick={() =>
                void run(async () => {
                  setBackup(
                    await createBackup(
                      await readLegacyWorkspace(),
                      true,
                      readLegacyFile,
                    ),
                  );
                  setConfirmed(false);
                })
              }
            >
              이전 브라우저 기록 확인
            </button>
          )}
          <button
            className={styles.primaryButton}
            disabled={!ready || pending || saving}
            onClick={() => void exportBackup()}
          >
            백업 내보내기
          </button>
          <label className={styles.secondaryButton}>
            백업 파일 선택
            <input
              ref={input}
              aria-label="백업 파일 선택"
              type="file"
              accept="application/json,.json"
              disabled={!ready || pending || saving}
              className={styles.srOnly}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importBackup(file);
              }}
            />
          </label>
        </div>
        {backup && !preview && (
          <p className={styles.formError}>
            현재 기록과 안전하게 병합할 수 없습니다. 백업 범위와 ID를
            확인해주세요.
          </p>
        )}
        {preview && backup && (
          <div className={styles.transferPreview}>
            <h3>가져오기 확인</h3>
            <p>
              새 항목 {preview.added}개 · 내용 충돌 {preview.conflicts}개(현재
              기록 유지) · 파일 원본 {backup.files.length}개
            </p>
            <p>
              가져올 프로젝트: 회사{" "}
              {backup.data.projects.filter((p) => p.space === "company").length}
              개 · 개인{" "}
              {
                backup.data.projects.filter((p) => p.space === "personal")
                  .length
              }
              개
            </p>
            <p>
              {backup.includesFiles
                ? "원본 포함 백업"
                : "원본 제외 백업입니다. 파일 연결 정보만 복원합니다."}
            </p>
            <label className={styles.confirmation}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              회사·개인 범위와 병합 내용을 확인했습니다.
            </label>
            <button
              className={styles.primaryButton}
              disabled={!confirmed || pending || saving}
              onClick={() => void applyBackup()}
            >
              기존 기록을 유지하며 병합
            </button>
          </div>
        )}
      </section>
      {!account?.enabled && (
        <section
          className={styles.settingsCard}
          aria-label="서버 저장과 기기 간 연결"
        >
          <h2>서버 저장 · 기기 간 연결</h2>
          <p>
            {cloud.available
              ? "인증된 계정의 회사·개인 자료를 서버에서 각각 보관합니다. 자동 덮어쓰기 대신 검토·병합 후 저장합니다."
              : cloud.reason}
          </p>
          <p className={styles.settingsNote}>
            현재 기본 저장은 이 브라우저입니다. 운영 계정·저장 스키마가
            승인·연결되기 전에는 다른 기기에서 같은 자료가 자동으로 나타나지
            않습니다.
          </p>
          <div className={styles.projectActions}>
            <button
              className={styles.secondaryButton}
              disabled={pending}
              onClick={() =>
                void run(async () => setCloud(await cloudStatus()))
              }
            >
              서버 연결 확인
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!cloud.available || pending || saving}
              onClick={() => void reviewServer()}
            >
              현재 영역의 서버 자료 검토
            </button>
            <button
              className={styles.primaryButton}
              disabled={
                !cloud.available ||
                !revision ||
                revision.space !== space ||
                pending ||
                saving
              }
              onClick={() => void publish()}
            >
              현재 영역을 서버에 저장
            </button>
          </div>
          {remotePreview && remote && (
            <div className={styles.transferPreview}>
              <h3>
                {spaceLabels[space]} 서버 버전 {remote.revision}
              </h3>
              <p>
                새 항목 {remotePreview.added}개 · 충돌 {remotePreview.conflicts}
                개
              </p>
              <label className={styles.confirmation}>
                <input
                  type="checkbox"
                  checked={useRemote}
                  onChange={(e) => setUseRemote(e.target.checked)}
                />{" "}
                충돌한 같은 ID의 항목은 서버 내용을 사용(해제 시 이 기기 내용
                유지)
              </label>
              <details>
                <summary>서버 자료 상세 확인</summary>
                <pre>{JSON.stringify(remote.data, null, 2)}</pre>
              </details>
              <label className={styles.confirmation}>
                <input
                  type="checkbox"
                  checked={cloudConfirmed}
                  onChange={(e) => setCloudConfirmed(e.target.checked)}
                />{" "}
                병합 기준을 확인했습니다. 저장 전 백업을 권장합니다.
              </label>
              <button
                className={styles.primaryButton}
                disabled={!cloudConfirmed || pending || saving}
                onClick={() => void mergeServer()}
              >
                검토한 기준으로 병합
              </button>
            </div>
          )}
        </section>
      )}
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </>
  );
}
