"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { dateLabel, type Note, type Project } from "@/lib/workspace/types";
import { Modal } from "./workspace-controls";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import notesStyle from "./saved-notes.module.css";

export function MemoScopeNotice({ count, onShowAll }: { count: number; onShowAll?: () => void }) {
  return <p className={notesStyle.scopeNotice}>이 프로젝트 밖에 메모 {count}개가 있습니다.{" "}
    {onShowAll ? <button type="button" onClick={onShowAll}>모든 프로젝트 메모 보기</button> : <Link href="/memos">모든 프로젝트 메모 보기</Link>}
  </p>;
}

export function SavedNotes({ notes, projects, compact = false, scopeHelp }: { notes: Note[]; projects: Project[]; compact?: boolean; scopeHelp?: ReactNode }) {
  const [filter, setFilter] = useState({ query: "", page: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = compact ? 3 : 10;
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const found = useMemo(() => {
    const words = filter.query.normalize("NFC").toLocaleLowerCase("ko-KR").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return notes;
    return notes.filter(note => {
      const text = `${note.content}\n${projectById.get(note.projectId ?? "")?.name ?? ""}`.normalize("NFC").toLocaleLowerCase("ko-KR");
      return words.every(word => text.includes(word));
    });
  }, [notes, projectById, filter.query]);
  const pages = Math.max(1, Math.ceil(found.length / pageSize)), page = Math.min(filter.page, pages - 1);
  const selected = selectedId ? notes.find(note => note.id === selectedId) : undefined;
  const selectedProject = selected && projectById.get(selected.projectId ?? "");
  const projectName = (note: Note) => projectById.get(note.projectId ?? "")?.name ?? "프로젝트 연결 없음";
  return <section className={notesStyle.browser} aria-label="저장한 메모" id={compact ? "home-saved-notes" : undefined}>
    <div className={notesStyle.heading}><h3>저장한 메모 <span>{notes.length}</span></h3>{compact && <Link href="/memos">메모 모아보기 →</Link>}</div>
    <label className={notesStyle.search}><Icon name="search" size={16} /><span className={styles.srOnly}>저장한 메모 검색</span>
      <input aria-label="저장한 메모 검색" type="search" maxLength={200} value={filter.query} onChange={event => setFilter({ query: event.target.value, page: 0 })} placeholder="내용이나 프로젝트로 찾기" />
    </label>
    <div className={notesStyle.results} aria-live="polite" role="status">{filter.query.trim() ? `검색 결과 ${found.length}개` : `최근 수정 순 · ${notes.length}개`}</div>
    {scopeHelp}
    {found.length ? <ul className={notesStyle.list}>{found.slice(page * pageSize, (page + 1) * pageSize).map(note => {
      const title = note.content.split(/\r?\n/, 1)[0].trim().slice(0, 80) || "내용 보기";
      const preview = note.content.includes("\n") ? note.content.slice(note.content.indexOf("\n") + 1).trim() : note.content.slice(80);
      return <li key={note.id}><button type="button" aria-label={`메모 읽기: ${title}`} className={notesStyle.card} onClick={() => setSelectedId(note.id)}>
        <div><strong>{title}</strong>{preview && <p>{preview.slice(0, 180)}</p>}<small>{projectName(note)} · {dateLabel(note.updatedAt)}</small></div><Icon name="arrow" size={15} />
      </button></li>;
    })}</ul> : <div className={notesStyle.empty}><Icon name="note" size={24} /><p>{notes.length ? "일치하는 메모가 없습니다." : "이 범위에서 표시할 메모가 없습니다."}</p>
      {filter.query && <button type="button" onClick={() => setFilter({ query: "", page: 0 })}>검색 지우기</button>}
      {!notes.length && !scopeHelp && <Link href="/settings#storage-recovery">메모 저장 위치 확인</Link>}
    </div>}
    {pages > 1 && <nav className={notesStyle.pagination} aria-label="메모 페이지">
      <button type="button" disabled={page === 0} onClick={() => setFilter(current => ({ ...current, page: page - 1 }))}>이전 메모</button>
      <span>{page + 1} / {pages}</span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => setFilter(current => ({ ...current, page: page + 1 }))}>다음 메모</button>
    </nav>}
    {selected && <Modal title="메모 읽기" onClose={() => setSelectedId(null)}>
      <div className={`${styles.modalBody} ${notesStyle.reader}`}>
        <div className={notesStyle.metadata}><span>{projectName(selected)}</span><span>수정 {dateLabel(selected.updatedAt)}</span></div>
        <p className={notesStyle.fullText}>{selected.content}</p>
        <div className={styles.modalActions}>{selectedProject && <Link className={styles.secondaryButton} href={`/projects/${selected.projectId}`}>연결 프로젝트 열기 →</Link>}
          <button type="button" className={styles.primaryButton} onClick={() => setSelectedId(null)}>읽기 닫기</button>
        </div>
      </div>
    </Modal>}
  </section>;
}
