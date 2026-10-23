"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Space } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { MemoScopeNotice, SavedNotes } from "./saved-notes";
import { Icon } from "./icon";
import styles from "./studio.module.css";
export function MemosPage() {
  const { data, ready, error } = useWorkspace();
  const space = data.activeSpace;
  // Reading the archive must not inherit or rewrite another screen's saved scope.
  const [filters, setFilters] = useState<Record<Space, string | null>>({ company: null, personal: null });
  const projects = useMemo(() => data.projects.filter(project => project.space === space), [data.projects, space]);
  const projectId = projects.some(project => project.id === filters[space]) ? filters[space] : null;
  const spaceNotes = useMemo(() => data.notes.filter(note => note.space === space).slice().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [data.notes, space]);
  const notes = useMemo(() => projectId ? spaceNotes.filter(note => note.projectId === projectId) : spaceNotes, [spaceNotes, projectId]);
  return <div className={styles.studio}><WorkspaceControls selectedProjectId={projectId ?? ""} onProjectFilterChange={(id, scope) => setFilters(current => ({ ...current, [scope]: id }))} />
    <div className={styles.pageHeading}><div><h1>메모</h1><p>현재 영역의 모든 프로젝트 메모부터 보여줍니다. 프로젝트를 골라 좁혀볼 수 있습니다.</p></div><Link href="/#home-notes" className={styles.primaryButton}><Icon name="plus" size={16} /> 새 메모 쓰기</Link></div>
    {ready ? <div className={styles.detailSection}><SavedNotes key={`${space}:${projectId}`} notes={notes} projects={projects} scopeHelp={projectId && spaceNotes.length > notes.length ? <MemoScopeNotice count={spaceNotes.length - notes.length} onShowAll={() => setFilters(current => ({ ...current, [space]: null }))} /> : undefined} /></div> : <p role="status">{error ? "기존 기록을 다시 불러와주세요." : "메모를 불러오는 중입니다."}</p>}
  </div>;
}
