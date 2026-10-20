"use client";
import { ProjectReleasePanel } from "./project-release";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Project } from "@/lib/workspace/types";
import { id, now, dateLabel } from "@/lib/workspace/types";
import { savePlan, enqueuePlanning, changePlanning, applyPlanningProposal, planningBusy, newPlanning } from "@/lib/projects/planning";
import { startDevelopment, projectStage, stageLabels } from "@/lib/projects/lifecycle";
import { projectUrl } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import { WorkspaceControls } from "./workspace-controls";
import styles from "./project-planning.module.css";

function PlanText({ content }: { content: string }) {
  return <div className={styles.planText}>{content.split("\n").map((line, i) => /^#{1,3} /.test(line)
    ? <h3 key={i}>{line.replace(/^#+ /, "")}</h3> : <p key={i}>{line || "\u00a0"}</p>)}</div>;
}
function ProjectControls({ project }: { project: Project }) {
  const router = useRouter();
  return <WorkspaceControls selectedProjectId={project.id} onScopeChange={projectId => router.push(projectId ? `/projects/${projectId}` : "/projects")} />;
}
export function ProjectPlanning({ project }: { project: Project }) {
  const { mutate, saving, account, retryCloud, retryLoad } = useWorkspace(), clock = useWorkspaceClock();
  const plan = project.planning ?? newPlanning(project.createdAt), doc = plan.document;
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [edit, setEdit] = useState<{ content: string; revision: number; versionId: string } | null>(null);
  const [tab, setTab] = useState("plan");
  const lock = useRef(false), requestId = useRef(id());
  const busy = planningBusy(project), online = !!plan.runnerSeenAt && clock - Date.parse(plan.runnerSeenAt) < 120000;
  async function act(transform: Parameters<typeof mutate>[0]) {
    if (lock.current || saving) return false;
    lock.current = true; setError("");
    try { await mutate(transform); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "기획 작업을 저장하지 못했습니다."); return false; }
    finally { lock.current = false; }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim() || busy) return;
    if (await act(d => enqueuePlanning(d, project.space, project.id, message, now(), requestId.current))) {
      requestId.current = id(); setMessage("");
    }
  }
  async function changeRequest(turnId: string, action: "cancel" | "retry") {
    if (!account?.authenticated) { await act(d => changePlanning(d, project.space, project.id, turnId, action, now())); return; }
    if (lock.current || saving) return;
    lock.current = true; setError("");
    try {
      await retryCloud();
      const response = await fetch("/api/automation/planning", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space: project.space, projectId: project.id, jobId: turnId, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "기획 요청 상태를 변경하지 못했습니다.");
      retryLoad();
    } catch (e) { retryLoad(); setError(e instanceof Error ? e.message : "기획 요청 상태를 변경하지 못했습니다."); }
    finally { lock.current = false; }
  }
  return <div className={styles.page}>
    <ProjectControls project={project} /><Link href="/projects">← 프로젝트 목록</Link>
    <header className={styles.heading}><div><small>기획 프로젝트</small><h1>{project.name}</h1><p>{project.description || "아이디어를 이야기하며 첫 기획안을 만들어보세요."}</p></div>
      <button disabled={saving || busy || !!edit || !!message.trim()} onClick={() => void act(d => startDevelopment(d, project.space, project.id, now()))}>개발 시작</button>
    </header>
    <p className={styles.status}>기획 → 개발 → 사용 · 개발을 시작하면 현재 기획안이 개발 명세로 이어집니다.</p>
    <nav className={styles.tabs} aria-label="기획 공간 보기"><button aria-pressed={tab === "plan"} onClick={() => setTab("plan")}>기획안</button><button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>AI 대화</button></nav>
    <div className={styles.layout} data-tab={tab}>
      <section className={styles.document} aria-label="프로젝트 기획안"><div className={styles.sectionHeading}><h2>기획안</h2><span>버전 {doc.revision}</span>
        {!edit && <button onClick={() => setEdit({ content: doc.content, revision: doc.revision, versionId: doc.versionId })}>직접 편집</button>}</div>
        {edit ? <form onSubmit={event => { event.preventDefault(); void act(d => savePlan(d, project.space, project.id, edit.content, edit.revision, now(), edit.versionId)).then(ok => { if (ok) setEdit(null); }); }}>
          {edit.versionId !== doc.versionId && <p role="status">새 기획안이 도착했습니다. 입력한 내용은 유지되어 있습니다. 최신 기획안과 비교한 뒤 다시 편집해주세요.</p>}
          <textarea aria-label="기획안 내용" rows={20} maxLength={16000} value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} />
          <div className={styles.actions}><button disabled={saving || edit.versionId !== doc.versionId}>기획안 저장</button><button type="button" onClick={() => setEdit(null)}>편집 닫기</button></div>
        </form> : doc.content ? <><PlanText content={doc.content} /><small>{doc.author === "cli" ? "AI 반영" : "직접 편집"} · {dateLabel(doc.updatedAt)}</small></>
          : <div className={styles.empty}><h3>한 문장 아이디어부터 시작하세요</h3><p>문제와 사용자, 핵심 기능, 확인할 가정과 개발 완료 기준을 대화하며 정리합니다.</p><button onClick={() => { setMessage("이 아이디어의 목표 사용자와 해결할 문제를 정리하고 첫 기획안을 만들어주세요."); setTab("chat"); }}>첫 기획안 만들기</button></div>}
        {plan.history.length > 0 && <details className={styles.history}><summary>기획안 변경 이력 · 최근 {plan.history.length}개</summary>{[...plan.history].reverse().map(h => <details key={h.id}><summary>버전 {h.revision} · {h.author === "cli" ? "AI 반영" : "직접 편집"} · {dateLabel(h.updatedAt)}</summary><PlanText content={h.content || "빈 기획안"} /></details>)}</details>}
      </section>
      <section className={styles.chat} aria-label="기획 AI 대화"><div className={styles.sectionHeading}><h2>기획 AI</h2><span role="status">{online ? "기획 CLI 연결됨" : "기획 CLI 연결 대기"}</span></div>
        <p className={styles.status}>대화에 따라 기획안을 갱신합니다. 확인되지 않은 사업성·시장 정보는 가정으로 구분합니다.</p>
        <div className={styles.messages}>{plan.turns.length ? plan.turns.map(t => <article key={t.id} aria-label="기획 요청"><p className={styles.request}>{t.request}</p>
          {t.result ? <><p>{t.result.reply}</p><small>{t.appliedRevision !== undefined ? `기획안 버전 ${t.appliedRevision}에 반영` : "직접 편집된 기획안을 보존했습니다. AI 제안을 비교해 적용할 수 있습니다."}</small>
            {t.appliedRevision === undefined && <details><summary>AI 기획안 제안 보기</summary><PlanText content={t.result.document} /><button disabled={saving || !!edit} onClick={() => void act(d => applyPlanningProposal(d, project.space, project.id, t.id, doc.revision, now(), doc.versionId))}>현재 기획안에 제안 적용</button></details>}</>
            : <p role="status">{t.status === "queued" ? !account?.authenticated ? "이 기기에 저장됐습니다. 서버 연결 후 기획 실행기가 처리합니다." : !online ? "기획을 지원하는 실행기 2.8.0 연결을 기다립니다. 업데이트가 적용되면 저장된 요청을 처리합니다." : "기획 요청 대기 중입니다." : t.status === "running" ? "기획안을 작성하고 있습니다." : t.status === "cancelled" ? "요청을 취소했습니다." : t.error === "cli_limit" ? "구독 사용 한도에 도달했습니다." : t.error === "cli_login_required" ? "맥미니의 구독 CLI 로그인을 확인해주세요." : "기획 요청을 완료하지 못했습니다. 기존 기획안은 보존됩니다."}</p>}
          <div className={styles.actions}>{["queued", "running"].includes(t.status) && <button disabled={saving} onClick={() => void changeRequest(t.id, "cancel")}>기획 요청 취소</button>}
            {["failed", "interrupted"].includes(t.status) && <button disabled={saving || busy} onClick={() => void changeRequest(t.id, "retry")}>기획 요청 재시도</button>}</div>
        </article>) : <p>무엇을 만들고 싶은지, 누구에게 필요한지 자유롭게 이야기해주세요.</p>}</div>
        <form onSubmit={send} className={styles.composer}><label htmlFor="planning-message">기획 AI에게 요청</label><textarea id="planning-message" value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={4000} placeholder="아이디어나 기획안에서 바꿀 내용을 적어주세요." /><button disabled={saving || busy || !message.trim()}>기획 요청 보내기</button></form>
        <details><summary>기획 AI 연결 안내</summary><p>맥미니의 구독 CLI를 사용합니다. GitHub 저장소 없이 기획하며 구독 사용량이 적용됩니다.</p><Link href="/settings#cli-runner">실행기 설정</Link></details>
      </section>
    </div>
    <ProjectBasics project={project} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

export function ProjectService({ project }: { project: Project }) {
  const { mutate, saving } = useWorkspace();
  const [url, setUrl] = useState(project.launchUrl ?? ""), [error, setError] = useState("");
  const lock = useRef(false);
  return <div className={styles.page}><ProjectControls project={project} /><Link href="/projects">← 프로젝트 목록</Link><header className={styles.heading}><div><small>사용 중 프로젝트</small><h1>{project.name}</h1><p>{project.description}</p></div><a href={project.launchUrl} target="_blank" rel="noopener noreferrer">서비스 열기 ↗</a></header>
    <section className={styles.document}><h2>서비스 주소 관리</h2><p>등록한 주소로 이동합니다. 서비스 내부 연결 상태는 해당 서비스에서 확인할 수 있습니다.</p><form onSubmit={event => {
      event.preventDefault(); if (saving || lock.current) return; lock.current = true; setError("");
      void mutate(d => { const launchUrl = projectUrl(url); if (!launchUrl) throw new Error("서비스 주소를 입력해주세요."); return { ...d, projects: d.projects.map(p => p.id === project.id && p.space === project.space ? { ...p, launchUrl } : p) }; }).catch(e => setError(e.message)).finally(() => { lock.current = false; });
    }}><label>서비스 주소<input type="url" required maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></label><button disabled={saving}>주소 저장</button></form></section><ProjectReleasePanel project={project} live /><ProjectBasics project={project} />{error && <p role="alert">{error}</p>}</div>;
}

function ProjectBasics({ project }: { project: Project }) {
  const { mutate, saving } = useWorkspace();
  const [name, setName] = useState(project.name), [description, setDescription] = useState(project.description), [error, setError] = useState("");
  const lock = useRef(false);
  return <details className={styles.document}><summary>프로젝트 정보 수정</summary><form onSubmit={event => {
    event.preventDefault(); if (saving || lock.current || !name.trim()) return; lock.current = true; setError("");
    void mutate(d => ({ ...d, projects: d.projects.map(p => p.id === project.id && p.space === project.space ? { ...p, name: name.trim(), description: description.trim() } : p) })).catch(e => setError(e.message)).finally(() => { lock.current = false; });
  }}><label>프로젝트 이름<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label><label>프로젝트 설명<textarea rows={3} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} /></label><button disabled={saving || !name.trim()}>프로젝트 정보 저장</button>{error && <p role="alert">{error}</p>}</form></details>;
}

export function ProjectStageControl({ project, planning = true }: { project: Project; planning?: boolean }) {
  const { mutate, saving } = useWorkspace();
  const [error, setError] = useState("");
  const busy = project.release && ["queued", "running"].includes(project.release.status) || project.setup && project.setup.status !== "ready" || project.automation?.turns.some(t => ["queued", "running", "interrupted"].includes(t.status));
  function change(stage: "idea" | "development") {
    setError(""); void mutate(d => {
      const p = d.projects.find(p => p.id === project.id && p.space === project.space);
      if (!p || p.release && ["queued", "running"].includes(p.release.status) || p.setup && p.setup.status !== "ready" || p.automation?.turns.some(t => ["queued", "running", "interrupted"].includes(t.status))) throw new Error("진행 중인 개발 작업을 먼저 마쳐주세요.");
      if (stage === "development" && p.stage !== undefined) throw new Error("프로젝트 단계가 변경됐습니다. 현재 단계를 다시 확인해주세요.");
      return { ...d, projects: d.projects.map(row => row.id === p.id && row.space === p.space ? { ...row, stage, ...(stage === "idea" ? { planning: row.planning ?? newPlanning(now()) } : {}) } : row) };
    }).catch(e => setError(e.message));
  }
  return <div className={styles.stageControl} role="group" aria-label="프로젝트 단계"><span>프로젝트 단계 · {stageLabels[projectStage(project)]}{!project.stage&&" · 이전 등록"}</span>
    {!project.stage&&<button type="button" disabled={saving || !!busy} onClick={()=>change("development")}>개발 단계로 설정</button>}
    {planning&&<button type="button" disabled={saving || !!busy} onClick={()=>change("idea")}>기획으로 전환</button>}
    {error && <p role="alert">{error}</p>}</div>;
}
