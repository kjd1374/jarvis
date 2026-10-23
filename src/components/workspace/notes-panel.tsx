"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { dateLabel, id, now, spaceLabels } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { Icon } from "./icon";
import { MemoScopeNotice, SavedNotes } from "./saved-notes";
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
  const projects = useMemo(() => data.projects.filter(project => project.space === space), [data.projects, space]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const [linkedProject, setLinkedProject] = useState(projectId ?? "");
  const [savedId, setSavedId] = useState("");
  const notes = useMemo(() => data.notes
    .filter(
      (n) => n.space === space && (!projectId || n.projectId === projectId),
    )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.notes, space, projectId]);
  const outsideCount = projectId ? data.notes.filter(note => note.space === space && note.projectId !== projectId).length : 0;
  const scopeHelp = outsideCount ? <MemoScopeNotice count={outsideCount} /> : undefined;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim() || saving || pending.current) return;
    pending.current = true;
    try {
      const stamp = now(), noteId = id();
      await mutate((d) => ({
        ...d,
        notes: [
          ...d.notes,
          {
            id: noteId,
            space,
            projectId: home ? linkedProject || null : projectId,
            content: content.trim(),
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      }));
      setContent("");
      setSavedId(noteId);
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
    <section className={styles.detailSection} aria-label="빠른 메모" id={home ? "home-notes" : undefined}>
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="note" size={17} />{" "}
          {home ? "메모 · 기록" : compact ? "빠른 메모" : "내 메모와 생각"}
        </h2>
        <span>
          {spaceLabels[space]} ·{" "}
          {projectId
            ? data.projects.find((p) => p.id === projectId)?.name
            : home ? "전체 프로젝트" : "영역 공통"}
        </span>
        {home && <a href="#home-saved-notes" className={layout.noteJump}>저장한 메모 {notes.length}개 ↓</a>}
      </div>
      {home && <p className={layout.noteIntro}>새 생각을 남기고, 저장한 기록을 바로 찾아보세요.</p>}
      <div className={home ? layout.noteWorkspace : undefined}>
      <div>
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
      </div>
      {home ? <SavedNotes key={savedId} notes={notes} projects={projects} compact scopeHelp={scopeHelp} /> : <div>{scopeHelp}{notes.length ? recentNotes : <p className={styles.detailFootnote}>이 범위에서 표시할 메모가 없습니다.{" "}{!scopeHelp && <Link href="/settings#storage-recovery">메모 저장 위치 확인</Link>}</p>}</div>}
      </div>
    </section>
  );
}
