"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { enqueueWork, changeWorkState } from "@/lib/automation/work";
import { repositoryFor } from "@/lib/automation/state";
import { dateLabel, id, now, type Project } from "@/lib/workspace/types";
import type { ProjectTurn } from "@/lib/automation/work-types";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import { Icon } from "./icon";
import styles from "./studio.module.css";
const phases: Record<ProjectTurn["phase"], string> = { queued: "실행 대기", preparing: "저장소 확인 중", coding: "코드 수정 중", testing: "변경 검사 중", publishing: "GitHub 반영·검증 중", reporting: "결과 정리 중" };
const outcomes = { answered: "답변 완료", no_changes: "검토 완료 · 코드 변경 없음", pr_open: "PR 작성 · 반영 대기", merged: "병합 완료 · 배포 확인 중", deployed: "배포 확인 완료", blocked: "확인 필요" };
const errors: Record<string, string> = {
  imported_request_review: "백업에서 복원한 요청입니다. 실행 내용을 확인한 뒤 이어서 실행해주세요.",
  runner_interrupted: "실행기 연결이 끊겼습니다. 원래 실행한 기기를 켜고 이어서 실행하면 저장된 작업 경과를 확인합니다.",
  repository_changed: "요청 이후 GitHub 연결이 바뀌었습니다. 현재 저장소로 다시 요청해주세요.",
  cli_login_required: "실행기에서 Codex의 ChatGPT 로그인이 필요합니다.", cli_limit: "Codex 구독 사용 한도에 도달했습니다.",
  cli_unavailable: "Codex 실행을 마치지 못했습니다. 실행기 상태를 확인해주세요.",
  github_auth_required: "실행기의 GitHub 저장소 접근 권한을 확인해주세요.", github_write_failed: "GitHub 반영을 마치지 못했습니다. 저장소 권한·보호 규칙을 확인해주세요.",
  base_changed: "작업 중 기본 브랜치가 변경돼 병합을 멈췄습니다. PR에서 최신 변경과 함께 확인해주세요.",
  branch_changed: "작업 브랜치가 변경돼 자동 반영을 멈췄습니다.", change_scope_exceeded: "자동 변경 범위를 벗어난 파일이 있어 확인이 필요합니다.",
  secret_in_change: "변경 파일에 인증값으로 보이는 내용이 있어 게시를 멈췄습니다.",
};
export function ProjectAgent({ project }: { project: Project }) {
  const { data, mutate, saving, account } = useWorkspace();
  const clock = useWorkspaceClock();
  const services = data.services.filter(s => s.space === project.space && s.projectId === project.id && repositoryFor(s));
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const service = services.find(s => s.id === serviceId) ?? services[0];
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"change" | "ask">("change");
  const [publish, setPublish] = useState<"merge" | "pr">("merge");
  const [error, setError] = useState("");
  const pending = useRef(false), requestId = useRef(id());
  const turns = project.automation?.turns ?? [];
  const messages = useRef<HTMLDivElement>(null);
  const lastUpdate = turns.at(-1)?.updatedAt;
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [lastUpdate, turns.length]);
  const seen = service?.monitoring?.runnerSeenAt;
  const online = !!seen && clock - Date.parse(seen) < 120_000;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending.current || saving || !message.trim() || !service) return;
    pending.current = true; setError("");
    try {
      await mutate(d => enqueueWork(d, project.space, project.id, service.id, message, mode, publish, now(), requestId.current));
      setMessage(""); requestId.current = id();
    } catch (e) { setError(e instanceof Error ? e.message : "요청을 저장하지 못했습니다."); }
    finally { pending.current = false; }
  }
  async function act(turn: ProjectTurn, action: "cancel" | "retry") {
    try { await mutate(d => changeWorkState(d, project.space, project.id, turn.id, action, now())); }
    catch (e) { setError(e instanceof Error ? e.message : "상태를 변경하지 못했습니다."); }
  }
  return <section id="project-ai" className={`${styles.detailSection} ${styles.projectAgent}`} aria-label="프로젝트 AI 작업실">
    <div className={styles.detailHeading}><h2><Icon name="message" size={18} /> AI와 프로젝트 작업</h2><span role="status">{online ? "CLI 연결됨" : "CLI 연결 대기"}</span></div>
    <p className={styles.detailFootnote}>원하는 변경이나 궁금한 점을 보내세요. 저장소 확인부터 수정·검증, 결과와 다음 할 일 정리까지 이어집니다.</p>
    {!online && <p className={styles.agentConnection}>{account?.authenticated ? "요청은 저장되며, 실행기가 연결되면 순서대로 처리합니다." : "CLI 자동 실행은 서버에 연결된 업무실에서 사용할 수 있습니다. 현재 요청은 이 브라우저에 저장됩니다."} <Link href="/settings#cli-runner">CLI 연결 안내 →</Link></p>}
    {turns.length > 0 && <div ref={messages} className={styles.agentMessages} aria-label="프로젝트 작업 대화">
      {turns.slice(-20).map(turn => <article key={turn.id} className={styles.agentTurn}>
        <div className={styles.detailHeading}><strong>내 요청 · {turn.mode === "ask" ? "질문" : turn.publish === "merge" ? "수정·검증 후 반영" : "수정 후 PR 검토"}</strong><span>{dateLabel(turn.createdAt)}</span></div>
        <p className={styles.agentText}>{turn.request}</p>
        <div className={styles.agentReply}><strong>{turn.result ? outcomes[turn.result.outcome] : turn.status === "cancelled" ? "요청 취소됨" : turn.status === "failed" || turn.status === "interrupted" ? "확인 필요" : phases[turn.phase]}</strong>
          {turn.result ? <><p className={styles.agentText}>{turn.result.reply}</p>{turn.result.prUrl && <a href={turn.result.prUrl} target="_blank" rel="noopener noreferrer">변경 PR 열기 ↗</a>}{turn.result.deployment.url && <a href={turn.result.deployment.url} target="_blank" rel="noopener noreferrer">반영된 화면 열기 ↗</a>}</> : <p>{turn.error ? errors[turn.error] ?? "실행을 마치지 못했습니다. 저장된 작업 경과를 확인한 뒤 이어서 시도할 수 있습니다." : turn.status === "queued" ? "연결된 CLI가 이 요청을 가져가면 자동으로 시작합니다." : turn.status === "cancelled" ? "이미 반영된 변경은 되돌리지 않습니다." : "진행 상황과 결과가 이곳에 자동으로 갱신됩니다."}</p>}
          {turn.result && turn.error && <p role="status">{errors[turn.error] ?? "반영을 마치지 못했습니다. PR과 저장된 결과를 확인해주세요."}</p>}
          <div className={styles.projectActions}>
            {["failed", "interrupted"].includes(turn.status) && <button className={styles.secondaryButton} disabled={saving} onClick={() => void act(turn, "retry")}>이어서 실행</button>}
            {["queued", "running", "failed", "interrupted"].includes(turn.status) && <button className={styles.textButton} disabled={saving} onClick={() => void act(turn, "cancel")}>요청 취소</button>}
          </div>
        </div>
      </article>)}
      {turns.length > 20 && <details><summary>이전 요청 {turns.length - 20}개</summary>{turns.slice(0, -20).map(t => <p key={t.id}>{dateLabel(t.createdAt)} · {t.request}<br />{t.result?.reply}</p>)}</details>}
    </div>}
    <form onSubmit={submit} className={styles.agentComposer}>
      <label htmlFor="project-agent-message">AI에게 요청</label>
      <textarea id="project-agent-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={8000} rows={4} placeholder="예: 모바일에서 번역 버튼이 잘려 보여. 화면을 확인해 수정하고 검증 결과와 다음 할 일을 정리해줘." disabled={!service} />
      <div className={styles.agentComposerActions}>
        {services.length > 1 && <label>대상 저장소<select aria-label="대상 저장소" value={service?.id ?? ""} onChange={e => setServiceId(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{repositoryFor(s)}</option>)}</select></label>}
        <label>요청 방식<select aria-label="요청 방식" value={mode} onChange={e => setMode(e.target.value as "ask" | "change")}><option value="change">수정 요청</option><option value="ask">질문하기</option></select></label>
        {mode === "change" && <label>반영 범위<select aria-label="반영 범위" value={publish} onChange={e => setPublish(e.target.value as "pr" | "merge")}><option value="merge">검증 통과 후 병합·기존 자동 배포</option><option value="pr">PR 작성 후 내가 검토</option></select></label>}
        <button type="submit" className={styles.primaryButton} disabled={saving || !service || !message.trim()}>요청 보내기 <Icon name="arrow" size={16} /></button>
      </div>
      <p className={styles.detailFootnote}>{!service ? "먼저 이 프로젝트에 GitHub를 연결해주세요." : mode === "ask" ? "선택한 저장소를 읽고 답변합니다." : publish === "merge" ? "이 요청을 보내면 코드 수정·PR 작성·실제 검증 통과 후 병합을 실행합니다. 기존 자동 배포의 성공 여부도 확인합니다." : "코드 수정·검증과 PR 작성까지 실행합니다. 병합은 직접 결정합니다."}</p>
      {error && <p role="alert" className={styles.formError}>{error}</p>}
    </form>
  </section>;
}
export function ProjectAutomaticResults({ project }: { project: Project }) {
  const { data } = useWorkspace();
  const turns = (project.automation?.turns ?? []).filter(t => t.result && data.services.some(s => s.id === t.serviceId && s.space === project.space && s.projectId === project.id && repositoryFor(s) === t.repository));
  const latest = turns.at(-1);
  const monitor = data.services.filter(s => s.space === project.space && s.projectId === project.id && s.monitoring?.repository === repositoryFor(s))
    .map(s => s.monitoring!).filter(m => m.analysis).sort((a, b) => b.analysis!.generatedAt.localeCompare(a.analysis!.generatedAt))[0];
  const analysis = monitor?.analysis;
  const followups = data.tasks.filter(t => t.space === project.space && t.projectId === project.id && t.status !== "done" && (t.sourceSuggestionId || t.sourceMessageId));
  const results = latest?.result;
  return <section className={styles.automaticResults} aria-label="AI 자동 정리">
    <div className={styles.detailHeading}><h2>자동으로 정리한 프로젝트 현황</h2><span>{latest ? dateLabel(latest.updatedAt) : analysis ? dateLabel(analysis.generatedAt) : "첫 점검 대기"}</span></div>
    <div className={styles.projectDetailGrid}>
      <section className={styles.detailSection} aria-label="자동 프로젝트 현황"><h3>현재 상황·다음 행동</h3>
        <p className={styles.agentText}>{results?.summary || analysis?.summary || "GitHub 점검이 끝나면 프로젝트 개요와 진행 상황을 여기에 정리합니다."}</p>
        {(results?.currentStatus || analysis?.currentStatus) && <p>현재 상황: {results?.currentStatus || analysis?.currentStatus}</p>}
        {(results?.nextAction || analysis?.nextAction) && <p>다음 행동: {results?.nextAction || analysis?.nextAction}</p>}
        {analysis && !results && <p className={styles.detailFootnote}>AI 분석 · 저장소 {analysis.headSha.slice(0, 8)} 기준{monitor.error || analysis.basis !== monitor.inspection?.fingerprint ? " · 마지막 정상 분석, 최신 점검 필요" : ""}</p>}
      </section>
      <section className={styles.detailSection} aria-label="자동 수정 검증 결과"><h3>수정 내용·검증 결과</h3>
        {results ? <><p>{outcomes[results.outcome]}</p>{results.changes.length > 0 && <ul>{results.changes.map(path => <li key={path}>{path}</li>)}</ul>}
          {results.checks.length > 0 ? <ul>{results.checks.map((c, i) => <li key={i}><strong>{c.status === "passed" ? "통과" : c.status === "failed" ? "실패" : "미확인"} · {c.name}</strong><p>{c.detail}</p></li>)}</ul> : <p>코드 실행 검증 기록 없음</p>}
          {results.prUrl && <a href={results.prUrl} target="_blank" rel="noopener noreferrer">변경 PR·검증 기록 ↗</a>}
        </> : <p>수정 요청을 처리하면 변경 파일과 실제 검사 결과를 자동으로 기록합니다.</p>}
      </section>
      {(["todo", "decision"] as const).map(kind => <section key={kind} className={styles.detailSection} aria-label={kind === "todo" ? "자동 후속 업무" : "자동 확인 사항"}>
        <h3>{kind === "todo" ? "후속 업무" : "확인·결정할 사항"}</h3>
        {followups.some(t => kind === "todo" ? t.status !== "decision" : t.status === "decision") ? <ul>{followups.filter(t => kind === "todo" ? t.status !== "decision" : t.status === "decision").slice(-12).map(t => <li key={t.id}>{t.title}</li>)}</ul> : <p>{kind === "todo" ? "점검·작업 결과에서 필요한 후속 업무를 자동으로 추가합니다." : "추가 확인이 필요한 항목이 생기면 여기에 모읍니다."}</p>}
      </section>)}
    </div>
  </section>;
}
