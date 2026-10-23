"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { SavedNotes } from "./saved-notes";
import { Icon } from "./icon";
import styles from "./studio.module.css";
export function MemosPage() {
  const { data, ready, error } = useWorkspace();
  const space = data.activeSpace, projectId = data.activeProjects[space];
  const projects = useMemo(() => data.projects.filter(project => project.space === space), [data.projects, space]);
  const notes = useMemo(() => data.notes.filter(note => note.space === space && (!projectId || note.projectId === projectId)).slice().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [data.notes, space, projectId]);
  return <div className={styles.studio}><WorkspaceControls />
    <div className={styles.pageHeading}><div><h1>메모</h1><p>선택한 영역과 프로젝트의 메모를 검색하고 읽어보세요.</p></div><Link href="/#home-notes" className={styles.primaryButton}><Icon name="plus" size={16} /> 새 메모 쓰기</Link></div>
    {ready ? <div className={styles.detailSection}><SavedNotes key={`${space}:${projectId}`} notes={notes} projects={projects} /></div> : <p role="status">{error ? "기존 기록을 다시 불러와주세요." : "메모를 불러오는 중입니다."}</p>}
  </div>;
}
