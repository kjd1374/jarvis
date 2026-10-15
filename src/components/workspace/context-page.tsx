"use client";

import { useState } from "react";
import { dateLabel, spaceLabels } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { ContextEditor, WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import { NotesPanel } from "./notes-panel";
import styles from "./studio.module.css";

export function ContextPage() {
  const { data, ready } = useWorkspace();
  const [editing, setEditing] = useState<{
    projectId: string | null;
    space: string;
  } | null>(null);
  const space = data.activeSpace;
  const projectId = data.activeProjects[space];
  const contexts = data.contexts.filter(
    (c) =>
      c.space === space &&
      (!projectId || c.projectId === null || c.projectId === projectId),
  );
  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>CONTINUOUS CONTEXT</p>
          <h1>맥락</h1>
          <p>업무 배경, 기준과 결정 사항을 기록하고 계속 업데이트하세요.</p>
        </div>
        <button
          className={styles.primaryButton}
          disabled={!ready}
          onClick={() => setEditing({ projectId, space })}
        >
          <Icon name="plus" size={17} />
          맥락 기록
        </button>
      </div>
      <NotesPanel />
      <details className={styles.homeDetails}>
        <summary>누적 맥락과 수정 이력</summary>
        <div className={styles.contextCards}>
          {contexts.length ? (
            contexts.map((note) => (
              <article className={styles.contextCard} key={note.id}>
                <div>
                  <span className={styles.contextCardIcon}>
                    <Icon name="memory" size={20} />
                  </span>
                  <h2>
                    {note.projectId
                      ? data.projects.find((p) => p.id === note.projectId)?.name
                      : `${spaceLabels[space]} 전체 맥락`}
                  </h2>
                  <button
                    onClick={() =>
                      setEditing({ projectId: note.projectId, space })
                    }
                  >
                    편집
                  </button>
                </div>
                <p>{note.content || "아직 내용이 없습니다."}</p>
                <footer>
                  버전 {note.revision} · {dateLabel(note.updatedAt)}
                </footer>
                <details className={styles.revisionDetails}>
                  <summary>수정 이력 보기</summary>
                  {data.contextRevisions
                    .filter((r) => r.contextId === note.id)
                    .slice()
                    .reverse()
                    .map((revision) => (
                      <details key={revision.id}>
                        <summary>
                          버전 {revision.revision} ·{" "}
                          {dateLabel(revision.createdAt)}
                        </summary>
                        <p>{revision.content || "빈 맥락"}</p>
                      </details>
                    ))}
                </details>
              </article>
            ))
          ) : (
            <div className={styles.emptyState}>
              <span>
                <Icon name="memory" size={34} />
              </span>
              <h2>계속 기억할 맥락을 남겨주세요</h2>
              <p>
                회사와 개인의 기록은 구분됩니다. 업무실의 대화를 맥락으로 추가할
                수도 있습니다.
              </p>
              <button
                className={styles.secondaryButton}
                disabled={!ready}
                onClick={() => setEditing({ projectId, space })}
              >
                첫 맥락 기록
              </button>
            </div>
          )}
        </div>
      </details>
      {editing && editing.space === space && (
        <ContextEditor
          projectId={editing.projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
