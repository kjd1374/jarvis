"use client";

import { useRef, useState } from "react";
import {
  inspectStorageRecovery,
  restoreStorageRecovery,
  type StorageRecovery as Recovery,
} from "@/lib/workspace/storage";
import { useWorkspace } from "./workspace-provider";
import styles from "./studio.module.css";

export function StorageRecovery() {
  const { saving, retryLoad } = useWorkspace();
  const [result, setResult] = useState<Recovery | null>(null);
  const [origin, setOrigin] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const working = useRef(false);

  async function run(restore = false) {
    if (working.current || saving) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (restore) {
        if (!confirmed) return;
        await restoreStorageRecovery();
        retryLoad();
        // Other tabs must also retry their read instead of retaining stale data.
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("jarvis-workspace");
          channel.postMessage("updated");
          channel.close();
        }
        setNotice(
          "정상 저장본을 복구했습니다. 읽지 못했던 기록과 파일 원본은 삭제하지 않았습니다.",
        );
      }
      setResult(await inspectStorageRecovery());
      setOrigin(window.location.origin);
      setConfirmed(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "저장 상태를 확인하지 못했습니다.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      id="storage-recovery"
      className={styles.settingsCard}
      aria-label="브라우저 저장 진단과 복구"
    >
      <h2>브라우저 저장 진단과 복구</h2>
      <p>
        기록이 보이지 않으면 이 주소의 저장 상태부터 확인하세요. 확인만으로
        기록을 변경하지 않습니다.
      </p>
      <button
        className={styles.secondaryButton}
        disabled={busy || saving}
        onClick={() => void run()}
      >
        {busy ? "확인 중…" : "이 브라우저 저장 상태 확인"}
      </button>
      {result && (
        <div className={styles.storageInspection}>
          <p>현재 주소: {origin}</p>
          <p>
            현재 기록:{" "}
            {result.current === "valid"
              ? "정상적으로 읽을 수 있음"
              : result.current === "missing"
                ? "저장된 현재 기록 없음"
                : "기록이 있으나 읽을 수 없음"}
          </p>
          {result.checkpoint ? (
            <>
              <p>
                마지막 정상 저장:{" "}
                <time dateTime={result.checkpoint.savedAt}>
                  {new Date(result.checkpoint.savedAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  (한국 시간)
                </time>
              </p>
              <p>
                복구본의 프로젝트: 회사{" "}
                {
                  result.checkpoint.data.projects.filter(
                    (p) => p.space === "company",
                  ).length
                }
                개 · 개인{" "}
                {
                  result.checkpoint.data.projects.filter(
                    (p) => p.space === "personal",
                  ).length
                }
                개
              </p>
              {result.current !== "valid" && (
                <>
                  <p>
                    회사·개인 영역의 프로젝트·메모·업무 등 마지막 정상 기록을
                    함께 복구합니다. 파일 원본은 그대로 유지하며, 읽지 못한 현재
                    기록도 별도로 보존합니다.
                  </p>
                  <label className={styles.confirmation}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    회사·개인 기록의 복구 범위를 확인했습니다.
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={!confirmed || busy || saving}
                    onClick={() => void run(true)}
                  >
                    마지막 정상 저장본 복구
                  </button>
                </>
              )}
            </>
          ) : (
            <p>
              이 브라우저에서 확인할 수 있는 정상 저장본이 없습니다. 기존 백업
              파일이 있다면 위에서 검토 후 가져올 수 있습니다.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className={styles.settingsNote}>
        정상 저장본은 이번 버전부터 저장할 때 같은 브라우저에 보관합니다. 서버
        백업이 아니며, 브라우저 저장 공간 전체가 삭제되거나 다른 브라우저를
        사용하면 복구할 수 없습니다. 중요한 기록은 위의 백업 내보내기로 별도
        보관하세요.
      </p>
    </section>
  );
}
