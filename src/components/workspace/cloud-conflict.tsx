"use client";
import { useState } from "react";
import type { CloudConflict } from "@/lib/cloud/persistence";
import { useWorkspace } from "./workspace-provider";
import { spaceLabels } from "@/lib/workspace/types";
import { mergeCloudWorkspace } from "@/lib/cloud/merge";
import styles from "./studio.module.css";
export function CloudConflictReview() {
  const { conflict, resolveConflict, retryCloud } = useWorkspace();
  return conflict ? <ConflictReview key={conflict.reviewId} conflict={conflict} resolveConflict={resolveConflict} retryCloud={retryCloud} /> : null;
}
function ConflictReview({ conflict, resolveConflict, retryCloud }: { conflict: CloudConflict; resolveConflict: (preferLocal: boolean) => Promise<void>; retryCloud: (recheckConflict?: boolean) => Promise<void> }) {
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
      {counts && counts.conflicts.length > 0 && <ul>{[...new Set(counts.conflicts.map(path => {
        const parts = path.split(".");
        if (parts[0] === "projects" && parts.includes("automation")) return "AI 작업의 요청 또는 진행 상태";
        if (parts[0] === "projects" && parts.at(-1) === "description") return "프로젝트 설명";
        if (parts[0] === "projects" && parts.at(-1) === "name") return "프로젝트 이름";
        return ({ projects: "프로젝트 내용", services: "서비스 연결", tasks: "할 일", notes: "메모", documents: "문서", messages: "대화 내용", conversations: "대화", activeProjects: "프로젝트 선택", activeConversations: "대화 선택" } as Record<string, string>)[parts[0]] ?? "기록 내용";
      }))].map(label => <li key={label}>{label}</li>)}</ul>}
      <button className={styles.secondaryButton} disabled={busy} onClick={async () => {
        setBusy(true);
        try { await retryCloud(true); } finally { setBusy(false); }
      }}>최신 기록과 다시 비교</button>
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
