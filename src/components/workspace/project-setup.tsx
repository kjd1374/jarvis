"use client";
import { useState } from "react";
import { changeSetup, newProjectSetup } from "@/lib/automation/provision";
import { now, type Project } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { ProjectProviders } from "./project-providers";
import styles from "./studio.module.css";
const errors: Record<string, string> = {
  docker_unavailable: "맥미니의 Docker 엔진에 응답이 없습니다. 실행 중인지 확인하면 저장된 준비를 이어갈 수 있습니다.",
  supabase_requires_vercel: "Supabase를 사용하는 자동 환경은 Vercel 연결이 필요합니다. 맥미니는 프로젝트 전용 SQLite를 사용합니다.",
  github_setup_failed: "GitHub 저장소 생성 권한 또는 연결을 확인해야 합니다. 이미 만든 저장소는 유지하며 이어서 준비합니다.",
  vercel_connection_required: "이 영역의 Vercel 계정 연결이 필요합니다. 자동 선택으로 맥미니를 사용할 수도 있습니다.",
  supabase_connection_required: "이 영역의 Supabase 계정과 조직 연결이 필요합니다. 자동 선택은 맥미니의 로컬 저장을 사용할 수 있습니다.",
  supabase_not_ready: "Supabase 프로젝트가 생성되는 중입니다. 잠시 후 이어서 준비하면 기존 프로젝트를 확인합니다.",
  repository_identity_conflict: "같은 이름의 다른 저장소가 있어 연결을 멈췄습니다. 기존 저장소 주소를 등록해주세요.",
  setup_source_changed: "준비 중 저장소 코드가 변경됐습니다. 코드를 덮어쓰지 않고 준비를 중단했습니다.",
  imported_request_review: "백업에서 복원한 자동 준비입니다. 요청을 확인하고 이어서 준비해주세요.",
};
export function ProjectSetupPanel({ project }: { project: Project }) {
  const { data, mutate, saving, account } = useWorkspace();
  const [error, setError] = useState("");
  const s = project.setup;
  const runner = data.services.filter(v => v.space === project.space && v.monitoring?.runnerConnection).map(v => v.monitoring!.runnerConnection!).sort((a, b) => b.seenAt.localeCompare(a.seenAt))[0];
  const needsUpdate = runner?.version?.startsWith("2.") && Number(runner.version.split(".")[1]) < 6;
  async function act(action: "start" | "retry" | "cancel") {
    try {
      await mutate(d => action === "start" ? { ...d, projects: d.projects.map(p => p.id === project.id && p.space === project.space ? { ...p, setup: newProjectSetup(now()) } : p) } : changeSetup(d, project.space, project.id, action, now()));
    } catch (e) { setError(e instanceof Error ? e.message : "준비 요청을 저장하지 못했습니다."); }
  }
  return <section className={styles.agentConnection} aria-label="프로젝트 자동 준비">
    <strong>{!s ? "프로젝트 자동 준비" : s.status === "ready" ? "개발 환경 준비 완료" : s.status === "running" ? s.phase : s.status === "queued" ? "저장소·실행 환경 자동 준비 대기" : s.status === "cancelled" ? "자동 준비 취소됨" : "자동 준비 확인 필요"}</strong>
    {!s && <><p>비공개 GitHub 저장소와 실행 환경을 준비합니다. 이미 연결한 저장소가 있으면 그대로 사용합니다.</p><button className={styles.secondaryButton} disabled={saving} onClick={() => void act("start")}>자동으로 개발 환경 준비</button></>}
    {s?.status === "queued" && needsUpdate && <p role="status">마지막 확인한 실행기는 {runner?.version}입니다. 자동 준비를 시작하려면 이번 2.6.0 업데이트를 한 번 적용해야 합니다.</p>}
    {s?.status === "queued" && <p>{account?.authenticated ? "연결된 실행기 2.6.0 이상이 자동으로 처리합니다. 준비 중에도 아래 대화에 개발 요청을 남길 수 있습니다." : "현재 브라우저에 저장됐습니다. 서버 연결과 실행기 2.6.0 이상이 있어야 자동 준비가 실행됩니다."}</p>}
    {s?.result && <><p>{s.result.target === "mac" ? "맥미니" : "Vercel"} · {s.result.database === "sqlite" ? "프로젝트 전용 SQLite" : s.result.database === "supabase" ? "Supabase" : "별도 데이터베이스 없음"}</p><p>{s.result.reason}</p><details><summary>준비한 환경과 확인 결과</summary><ul>{s.result.checks.map(c => <li key={c.name}>{c.name}: {c.detail}</li>)}</ul></details></>}
    {s?.error && <p role="status">{errors[s.error] ?? "환경 준비 중 연결 또는 실행 오류가 발생했습니다. 저장된 자원을 유지하고 이어서 준비할 수 있습니다."}</p>}
    {s && ["failed", "interrupted", "cancelled"].includes(s.status) && <button className={styles.secondaryButton} disabled={saving} onClick={() => void act("retry")}>이어서 준비</button>}
    {s && ["queued", "running", "failed", "interrupted"].includes(s.status) && <button className={styles.textButton} disabled={saving} onClick={() => void act("cancel")}>자동 준비 취소</button>}
    {s && s.status !== "ready" && s.requests.map(r => <p key={r.id}>개발 대기: {r.request}</p>)}
    <ProjectProviders space={project.space} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
