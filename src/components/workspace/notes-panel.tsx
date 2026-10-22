"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { dateLabel, id, now, spaceLabels } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import layout from "./integrated-home.module.css";

export function NotesPanel({
  projectId,
  compact = false,
  home = false,
}: {
  projectId?: string | null;
  compact?: boolean;
  home?: boolean;
}) {
  const { data } = useWorkspace();
  const selected =
    projectId === undefined ? data.activeProjects[data.activeSpace] : projectId;
  return (
    <NotesView
      key={`${data.activeSpace}:${selected}`}
      projectId={selected}
      compact={compact}
      home={home}
    />
  );
}
function NotesView({
  projectId,
  compact,
  home,
}: {
  projectId: string | null;
  compact: boolean;
  home: boolean;
}) {
  const { data, ready, saving, mutate } = useWorkspace();
  const space = data.activeSpace;
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const [linkedProject, setLinkedProject] = useState(projectId ?? "");
  const [recentOpen, setRecentOpen] = useState(false);
  const notes = data.notes
    .filter(
      (n) => n.space === space && (!projectId || n.projectId === projectId),
    )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || saving || pending.current) return;
    pending.current = true;
    try {
      const stamp = now();
      await mutate((d) => ({
        ...d,
        notes: [
          ...d.notes,
          {
            id: id(),
            space,
            projectId: home ? linkedProject || null : projectId,
            content: content.trim(),
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      }));
      setContent("");
      setRecentOpen(true);
      setError("");
      setNotice(
        "메모를 저장했습니다. 외부 서비스에는 변경을 보내지 않았습니다.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "저장하지 못했습니다. 입력 내용은 유지됩니다.",
      );
    } finally {
      pending.current = false;
    }
  }
  const recentNotes = (
        <div className={styles.memoList}>
          {notes.slice(0, compact ? 3 : 30).map((note) => (
            <article key={note.id}>
              <span className={styles.detailBadge}>내 메모</span>
              <p>
                {compact && note.content.length > 180
                  ? `${note.content.slice(0, 180)}…`
                  : note.content}
              </p>
              {compact && note.content.length > 180 && (
                <details className={styles.revisionDetails}>
                  <summary>메모 전체 보기</summary>
                  <p>{note.content}</p>
                </details>
              )}
              <small>
                {dateLabel(note.updatedAt)} ·{" "}
                {note.projectId
                  ? data.projects.find((p) => p.id === note.projectId)?.name
                  : "영역 공통"}
              </small>
            </article>
          ))}
        </div>
  );
  return (
    <section className={styles.detailSection} aria-label="빠른 메모">
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="note" size={17} />{" "}
          {compact ? "빠른 메모" : "내 메모와 생각"}
        </h2>
        <span>
          {spaceLabels[space]} ·{" "}
          {projectId
            ? data.projects.find((p) => p.id === projectId)?.name
            : "영역 공통"}
        </span>
      </div>
      <form onSubmit={save} className={styles.quickNoteForm} aria-busy={saving}>
        <label
          className={styles.srOnly}
          htmlFor={`quick-note-${projectId ?? "all"}`}
        >
          빠른 메모 내용
        </label>
        <textarea
          id={`quick-note-${projectId ?? "all"}`}
          aria-label="빠른 메모 내용"
          value={content}
          maxLength={50000}
          rows={compact ? 3 : 4}
          disabled={!ready || saving}
          placeholder="떠오른 생각, 확인할 내용, 다음에 할 일을 남겨주세요."
          onChange={(event) => setContent(event.target.value)}
        />
        {home ? <div className={layout.noteTools}>
          <label>프로젝트<select aria-label="메모 연결 프로젝트" value={linkedProject} disabled={!ready || saving} onChange={event => setLinkedProject(event.target.value)}>
            {!projectId && <option value="">프로젝트 연결 안 함</option>}
            {data.projects.filter(project => project.space === space && (!projectId || project.id === projectId)).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
        <button
          className={styles.primaryButton}
          disabled={!ready || saving || !content.trim()}
        >
          {saving ? "저장 중…" : "메모 저장"}
        </button>
        </div> :         <button
          className={styles.primaryButton}
          disabled={!ready || saving || !content.trim()}
        >
          {saving ? "저장 중…" : "메모 저장"}
        </button>}
      </form>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.detailFootnote} role="status">
          {notice}
        </p>
      )}
      {notes.length ? home ? <details className={layout.recentNotes} open={recentOpen} onToggle={event => setRecentOpen(event.currentTarget.open)}>
        <summary>최근 메모 {notes.length}개</summary>

        {recentNotes}
        <Link href="/notes" className={layout.more}>전체 메모 보기 →</Link>
      </details> : recentNotes : (
        <p className={styles.detailFootnote}>아직 메모가 없습니다. 기록한 메모는 해당 영역과 프로젝트에 보관됩니다.</p>
      )}
    </section>
  );
}
