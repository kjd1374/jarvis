"use client";
import Link from "next/link";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { NotesPanel } from "./notes-panel";
import { ServiceWorkboard } from "./service-workboard";
import styles from "./studio.module.css";
import home from "./integrated-home.module.css";

export function IntegratedHome() {
  const { data, ready, error, account } = useWorkspace();
  const sheets = data.documents.filter(document => document.space === data.activeSpace && document.sheet && !document.sheet.archivedAt).length;
  return <div className={`${styles.studio} ${home.home}`}>
    <header className={home.heading}><h1>업무실</h1><WorkspaceControls showProjectFilter={false} className={home.controls} /><Link className={home.sheetLink} href="/tasks">시트 업무 <span>{sheets}</span> ↗</Link></header>
    {!ready ? <div className={styles.loadState} role="status"><p>{error ? "기존 기록을 다시 불러와주세요." : "업무실을 불러오는 중입니다."}</p></div> : <>
      <NotesPanel projectId={null} compact home />
      <ServiceWorkboard key={`${account?.accountId ?? "local"}:${data.activeSpace}`} />
    </>}
  </div>;
}
