"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/lib/workspace/types";
import { ProjectScreen } from "./project-screen";
import { ProjectAgent } from "./project-agent";
import { dateLabel } from "@/lib/workspace/types";
import styles from "./project-development.module.css";
export function ProjectDevelopment({ project }: { project: Project }) {
  const [tab, setTab] = useState(project.setup && project.setup.status !== "ready" ? "chat" : "screen");
  useEffect(() => {
    const open = () => { setTab("chat"); requestAnimationFrame(() => document.getElementById("project-agent-message")?.focus()); };
    window.addEventListener("jarvis-project-chat", open); return () => window.removeEventListener("jarvis-project-chat", open);
  }, []);
  const tests = [...(project.automation?.turns ?? [])].reverse().filter(turn => turn.mode === "test" && turn.result?.checks.length);
  return <div className={styles.workspace} data-view={tab} aria-label="개발 작업 공간">
    <nav className={styles.tabs} aria-label="개발 작업 보기">{[["screen", "화면"], ["chat", "개발 대화"], ["tests", "검사 결과"], ["all", "함께 보기"]].map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
    <div className={styles.screen}><ProjectScreen project={project} /></div>
    <div className={styles.chat}><ProjectAgent project={project} /></div>
    <section className={styles.tests} aria-label="개발 검사 결과"><details open={tab === "tests"}><summary>검사 기록 · {tests.length}건</summary>
      {tests.length ? tests.slice(0, 10).map(turn => <details key={turn.id} open={turn === tests[0]}><summary>{dateLabel(turn.updatedAt)} · {turn.result!.checks.filter(check => check.status === "passed").length}/{turn.result!.checks.length} 통과</summary>
        {turn.result!.checks.map((check, index) => <div key={index}><strong>{check.name} · {check.status === "passed" ? "통과" : check.status === "failed" ? "실패" : "미실행"}</strong><pre>{check.detail}</pre></div>)}
      </details>) : <p>화면 탭의 테스트 실행을 누르면 실제 실행 결과와 실패 원인을 여기에 표시합니다.</p>}
    </details></section>
  </div>;
}
