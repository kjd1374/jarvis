"use client";
import { useState } from "react";
import type { CloudConflict } from "@/lib/cloud/persistence";
import { useWorkspace } from "./workspace-provider";
import { spaceLabels } from "@/lib/workspace/types";
import { mergeCloudWorkspace } from "@/lib/cloud/merge";
import styles from "./studio.module.css";
export function CloudConflictReview() {
  const { conflict, resolveConflict } = useWorkspace();
  return conflict ? <ConflictReview key={conflict.reviewId} conflict={conflict} resolveConflict={resolveConflict} /> : null;
}
function ConflictReview({ conflict, resolveConflict }: { conflict: CloudConflict; resolveConflict: (preferLocal: boolean) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let counts;
  try {
    counts = mergeCloudWorkspace(conflict.base, conflict.local, conflict.remote.data);
  } catch {
    /* Invalid cross-scope data must not be merged. */
  }
  async function resolve(preferLocal: boolean) {
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await resolveConflict(preferLocal);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 검토해주세요.");
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="cloud-conflict"
      className={styles.settingsCard}
      aria-label="서버 변경 충돌 검토"
    >
      <h2>{spaceLabels[conflict.space]} 기록의 서버 변경 검토</h2>
      <p>
        서버 버전 {conflict.remote.revision}과 이 기기의 저장 대기가 다릅니다.
        양쪽 기록은 유지했습니다. 서로 다른 변경은 함께 보관하고, 같은 내용을
        양쪽에서 수정한 경우에만 아래 선택을 적용합니다. 실행 상태·결과는 서버의 최신 기록을 유지합니다.
      </p>
      {counts ? (
        <p>
          검토할 내용 충돌 {counts.conflicts.length}곳
        </p>
      ) : (
        <p role="alert">
          안전하게 병합할 수 없는 자료입니다. 먼저 백업해 내용을 확인해주세요.
        </p>
      )}
      <details>
        <summary>양쪽 기록 상세 비교</summary>
        <pre className={styles.jsonPreview}>
          {JSON.stringify(
            { 이기기: conflict.local, 서버: conflict.remote.data },
            null,
            2,
          )}
        </pre>
      </details>
      <label className={styles.confirmation}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        변경 내용과 충돌 처리 기준을 확인했습니다.
      </label>
      <div className={styles.projectActions}>
        <button
          className={styles.primaryButton}
          disabled={!confirmed || busy || !counts}
          onClick={() => void resolve(true)}
        >
          충돌은 이 기기 내용으로 병합
        </button>
        <button
          className={styles.secondaryButton}
          disabled={!confirmed || busy || !counts}
          onClick={() => void resolve(false)}
        >
          충돌은 서버 내용으로 병합
        </button>
      </div>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
