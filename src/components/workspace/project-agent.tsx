"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { enqueueWork, changeWorkState, latestWorkSource, preferredWorkRevision } from "@/lib/automation/work";
import { repositoryFor } from "@/lib/automation/state";
import { queuedWorkMessage, runnerOnline } from "@/lib/automation/runner-status";
import type { GitHubMonitoring } from "@/lib/automation/types";
import { dateLabel, id, now, type Project } from "@/lib/workspace/types";
import type { ProjectTurn } from "@/lib/automation/work-types";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import { Icon } from "./icon";
import { BriefText } from "./brief-text";
import { PreviewResult, previewMessage } from "./project-screen";
import { ProjectSetupPanel } from "./project-setup";
import { queueSetupRequest } from "@/lib/automation/provision";
import { ServiceRegistrationButton } from "./services-panel";
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
  work_source_changed: "선택한 PR이 변경되거나 닫혔습니다. 확인할 코드를 다시 선택해 요청해주세요.",
};
function turnStatus(turn: ProjectTurn) {
  if (turn.status === "cancelled") return "요청 취소됨";
  if (turn.error || turn.status === "failed" || turn.status === "interrupted") return "확인 필요";
  if (turn.status === "queued") return turn.mode === "preview" ? "화면 준비 대기" : turn.mode === "test" ? "자동 테스트 대기" : "실행 대기";
  if (turn.mode === "preview") return turn.result?.preview?.state === "ready" ? "화면 준비 완료" : turn.result ? "화면 준비 필요" : "화면 준비 중";
  if (turn.mode === "test") return turn.result ? turn.result.outcome === "answered" ? "자동 검증 통과" : "자동 검증 확인 필요" : "자동 테스트 대기·실행 중";
  return turn.result ? outcomes[turn.result.outcome] : phases[turn.phase];
}
function WorkTurn({ turn, project, saving, onAction, monitoring, clock }: { turn: ProjectTurn; project: Project; saving: boolean; onAction: (turn: ProjectTurn, action: "cancel" | "retry") => void; monitoring?: GitHubMonitoring; clock: number }) {
  return <article className={styles.agentTurn} aria-label="작업 요청">
    <div className={styles.detailHeading}><strong>{turnStatus(turn)}</strong><span>{dateLabel(turn.createdAt)}</span></div>
    <BriefText text={turn.request} label="요청 전문" limit={100} />
    <div className={styles.agentReply}>
      {turn.result ? <><BriefText text={turn.mode === "preview" && turn.result.preview ? previewMessage(turn.result.preview) : turn.result.reply} label="답변 전문" />
        {turn.result.checks.length > 0 && <details className={styles.compactDisclosure} open={turn.mode === "test"}>
          <summary>실행한 검사 · 통과 {turn.result.checks.filter(c => c.status === "passed").length} · 실패 {turn.result.checks.filter(c => c.status === "failed").length} · 미실행 {turn.result.checks.filter(c => c.status === "not_run").length}</summary>
          <ul>{turn.result.checks.map((check, index) => <li key={index}><strong>{check.name} · {check.status === "passed" ? "통과" : check.status === "failed" ? "실패" : "미실행"}</strong><BriefText text={check.detail} label="검사 실행 결과" /></li>)}</ul>
        </details>}
        {turn.result.outcome === "pr_open" && <p>수정본은 PR에 있으며 아직 기본 브랜치에 반영되지 않았습니다. ‘최근 수정본’을 선택해 테스트하거나 작업을 이어갈 수 있습니다.</p>}
        {turn.mode === "test" && <p>실제 AI·외부 서비스 연결과 마이크 동작은 별도 확인이 필요합니다.</p>}
        {turn.result.preview && <details className={styles.compactDisclosure}><summary>이 작업의 화면</summary><PreviewResult preview={turn.result.preview} project={project} turnId={turn.id} /></details>}
        {turn.result.prUrl && <a href={turn.result.prUrl} target="_blank" rel="noopener noreferrer">변경 PR 열기 ↗</a>}
        {turn.result.deployment.url && <a href={turn.result.deployment.url} target="_blank" rel="noopener noreferrer">반영된 화면 열기 ↗</a>}
      </> : !turn.error && <p>{turn.status === "queued" ? queuedWorkMessage(turn, monitoring, clock) : turn.status === "cancelled" ? "이미 반영된 변경은 유지됩니다." : "작업 중입니다. 결과는 자동으로 갱신됩니다."}</p>}
      {turn.error && <p role="status">{errors[turn.error] ?? "실행을 마치지 못했습니다. 저장된 결과를 확인한 뒤 이어서 시도해주세요."}</p>}
      <div className={styles.agentTurnActions}>
        <span>{turn.mode === "test" ? "자동 테스트 · 코드 게시·AI 호출 없음" : turn.mode === "preview" ? turn.previewAI === "codex" ? "화면 준비 · 구독 CLI 선택" : "화면 준비 · AI 호출 없음" : turn.mode === "ask" ? "질문" : turn.publish === "merge" ? "수정·검증 후 반영" : "수정 후 PR 검토"}</span>
        {["failed", "interrupted"].includes(turn.status) && <button className={styles.textButton} disabled={saving} onClick={() => onAction(turn, "retry")}>이어서 실행</button>}
        {["queued", "running", "failed", "interrupted"].includes(turn.status) && <button className={styles.textButton} disabled={saving} onClick={() => onAction(turn, "cancel")}>요청 취소</button>}
      </div>
    </div>
  </article>;
}
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
  const [revisionChoice, setRevision] = useState<{ serviceId: string; value: string } | null>(null);
  const revision = revisionChoice && revisionChoice.serviceId === service?.id ? revisionChoice.value : service ? preferredWorkRevision(project, service.id, repositoryFor(service)!) : "main";
  const recent = service && latestWorkSource(project, service.id, repositoryFor(service)!);
  const source = revision === "latest" ? recent : undefined;
  const pending = useRef(false), requestId = useRef(id());
  const turns = project.automation?.turns ?? [];
  const [historyLimit, setHistoryLimit] = useState(10);
  const latest = turns.at(-1);
  const history = turns.slice(0, -1);
  const needsAttention = history.filter(t => ["queued", "running", "failed", "interrupted"].includes(t.status));
  const previous = history.filter(t => !needsAttention.includes(t)).reverse();
  const monitoring = service?.monitoring?.repository === (service ? repositoryFor(service) : null) ? service?.monitoring : undefined;
  const seen = monitoring?.runnerSeenAt;
  const online = runnerOnline(monitoring, clock);
  const cliUpdateNeeded = turns.some(t => t.serviceId === service?.id && t.status === "queued" && t.previewAI === "codex") && !monitoring?.runnerConnection?.previewCli;
  const updateNeeded = online && (monitoring?.runnerConnection?.remoteWork === false || cliUpdateNeeded);
  const turnMonitoring = (turn: ProjectTurn) => services.find(s => s.id === turn.serviceId && s.monitoring?.repository === turn.repository)?.monitoring;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending.current || saving || !message.trim()) return;
    pending.current = true; setError("");
    try {
      await mutate(d => service ? enqueueWork(d, project.space, project.id, service.id, message, mode, publish, now(), requestId.current, source?.id, undefined, revision === "latest") : queueSetupRequest(d, project.space, project.id, message, mode, publish, now(), requestId.current));
      setMessage(""); requestId.current = id();
    } catch (e) { setError(e instanceof Error ? e.message : "요청을 저장하지 못했습니다."); }
    finally { pending.current = false; }
  }
  async function act(turn: ProjectTurn, action: "cancel" | "retry") {
    try { await mutate(d => changeWorkState(d, project.space, project.id, turn.id, action, now())); }
    catch (e) { setError(e instanceof Error ? e.message : "상태를 변경하지 못했습니다."); }
  }
  return <section id="project-ai" className={`${styles.detailSection} ${styles.projectAgent}`} aria-label="프로젝트 AI 작업실">
    <div className={styles.detailHeading}><h2><Icon name="message" size={18} /> AI와 프로젝트 작업</h2><span role="status" className={styles.runnerStatus} data-online={online && !updateNeeded}>{!service ? project.setup ? "개발 환경 자동 준비" : "GitHub 저장소 등록 필요" : updateNeeded ? "CLI 연결됨 · 새 기능 업데이트 필요" : online ? "Jarvis CLI 연결됨" : seen ? "Jarvis CLI 최근 응답 없음" : monitoring?.lastSuccessAt ? "CLI 실행 기록 있음 · 접속 미확인" : "CLI 연결 대기"}</span></div>
    {seen && <p className={styles.runnerEvidence}>실행기 최근 응답 {dateLabel(seen)} · 버전 {monitoring?.runnerConnection?.version ?? "미확인"} · 아래 답변은 대상 저장소의 작업 결과입니다.</p>}
    {updateNeeded && <p className={styles.agentConnection}>{cliUpdateNeeded ? "구독 CLI 미리보기에는 실행기 2.5.0 이상이 필요합니다." : "최근 응답한 실행기는 자동 테스트·수정본 선택을 지원하지 않습니다."} <Link href="/settings#cli-runner">실행기 업데이트 안내 →</Link></p>}
    {(project.setup || !service) && <ProjectSetupPanel project={project} />}
    {!service && !project.setup ? <div className={styles.agentConnection}><p>코드 작업과 화면 준비에 사용할 GitHub 저장소를 등록해주세요. 새 저장소는 README 등 초기 커밋이 있어야 합니다.</p><ServiceRegistrationButton preset="github" projectId={project.id}>GitHub 저장소 등록</ServiceRegistrationButton></div>
      : service && !online && <p className={styles.agentConnection}>{account?.authenticated ? "이 영역에 연결된 실행기가 프로젝트를 자동으로 찾습니다. 다음 응답을 기다리고 있으며 요청은 저장됩니다." : "CLI 자동 실행은 서버에 연결된 업무실에서 사용할 수 있습니다. 현재 요청은 이 브라우저에 저장됩니다."} <Link href="/settings#cli-runner">CLI 연결 안내 →</Link></p>}
    {project.setup && turns.length > 0 && <div className={styles.agentHistory} role="log" aria-label="프로젝트 개발 대화">
      {turns.length > historyLimit && <button className={styles.textButton} onClick={() => setHistoryLimit(limit => limit + 10)}>이전 대화 더 보기</button>}
      {turns.slice(-historyLimit).map(turn => <WorkTurn key={turn.id} turn={turn} project={project} saving={saving} onAction={act} monitoring={turnMonitoring(turn)} clock={clock} />)}
    </div>}
    <form onSubmit={submit} className={styles.agentComposer}>
      <label htmlFor="project-agent-message">AI에게 요청</label>
      <textarea id="project-agent-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={8000} rows={2} placeholder="원하는 변경이나 질문을 적어주세요." disabled={project.setup?.status === "cancelled"} />
      <div className={styles.agentComposerActions}>
        {services.length > 1 && <label>대상 저장소<select aria-label="대상 저장소" value={service?.id ?? ""} onChange={e => setServiceId(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{repositoryFor(s)}</option>)}</select></label>}
        {recent && <label>작업할 코드<select aria-label="작업할 코드" value={revision} onChange={e => setRevision({ serviceId: service!.id, value: e.target.value })}><option value="latest">저장된 PR 수정본 · 이어가기</option><option value="main">기본 브랜치 · 반영된 코드</option></select></label>}
        <label>요청 방식<select aria-label="요청 방식" value={mode} onChange={e => setMode(e.target.value as "ask" | "change")}><option value="change">수정 요청</option><option value="ask">질문하기</option></select></label>
        {mode === "change" && <label>반영 범위<select aria-label="반영 범위" value={publish} onChange={e => setPublish(e.target.value as "pr" | "merge")}><option value="merge">검증 후 병합·자동 배포</option><option value="pr">PR 작성 후 내가 검토</option></select></label>}
        <button type="submit" className={styles.primaryButton} disabled={saving || project.setup?.status === "cancelled" || !message.trim()}>요청 보내기 <Icon name="arrow" size={16} /></button>
      </div>
      <p className={styles.detailFootnote}>{!service ? "요청을 보내면 개발 환경을 자동 준비한 뒤 이어서 실행합니다." : mode === "ask" ? "선택한 저장소를 읽고 답변합니다." : publish === "merge" ? "코드 수정 → 검증 통과 후 병합 · 기존 자동 배포 확인" : "코드 수정·검증 → PR 작성 · 병합은 직접 결정"}</p>
      {source && <p className={styles.detailFootnote}>최근 수정본 {source.result!.headSha!.slice(0, 8)}에서 이어갑니다. 실행기 2.4.0 이상이 필요합니다.</p>}
      {error && <p role="alert" className={styles.formError}>{error}</p>}
    </form>
    {!project.setup && latest && <div className={styles.agentLatest} aria-label="최근 요청"><WorkTurn key={latest.id} turn={latest} project={project} saving={saving} onAction={act} monitoring={turnMonitoring(latest)} clock={clock} /></div>}
    {!project.setup && needsAttention.length > 0 && <details className={styles.compactDisclosure}>
      <summary>진행·확인 필요 {needsAttention.length}건</summary>
      <div className={styles.agentHistory}>{needsAttention.map(turn => <WorkTurn key={turn.id} turn={turn} project={project} saving={saving} onAction={act} monitoring={turnMonitoring(turn)} clock={clock} />)}</div>
    </details>}
    {!project.setup && previous.length > 0 && <details className={styles.compactDisclosure}>
      <summary>이전 대화 {previous.length}건</summary>
      <div className={styles.agentHistory}>{previous.slice(0, historyLimit).map(turn => <WorkTurn key={turn.id} turn={turn} project={project} saving={saving} onAction={act} monitoring={turnMonitoring(turn)} clock={clock} />)}
        {previous.length > historyLimit && <button className={styles.textButton} onClick={() => setHistoryLimit(limit => limit + 10)}>이전 대화 더 보기</button>}
      </div>
    </details>}
  </section>;
}
export function ProjectAutomaticResults({ project }: { project: Project }) {
  const { data } = useWorkspace();
  const turns = (project.automation?.turns ?? []).filter(t => t.mode !== "preview" && t.result && data.services.some(s => s.id === t.serviceId && s.space === project.space && s.projectId === project.id && repositoryFor(s) === t.repository));
  const latest = turns.at(-1);
  const monitor = data.services.filter(s => s.space === project.space && s.projectId === project.id && s.monitoring?.repository === repositoryFor(s))
    .map(s => s.monitoring!).filter(m => m.analysis).sort((a, b) => b.analysis!.generatedAt.localeCompare(a.analysis!.generatedAt))[0];
  const analysis = monitor?.analysis;
  const followups = data.tasks.filter(t => t.space === project.space && t.projectId === project.id && t.status !== "done" && (t.sourceSuggestionId || t.sourceMessageId));
  const results = latest?.result;
  const tasksByKind = { todo: followups.filter(t => t.status !== "decision"), decision: followups.filter(t => t.status === "decision") };
  return <section className={`${styles.detailSection} ${styles.automaticResults}`} aria-label="AI 자동 정리">
    <div className={styles.detailHeading}><h2>대상 프로젝트 현황</h2><span>{latest ? dateLabel(latest.updatedAt) : analysis ? dateLabel(analysis.generatedAt) : "첫 점검 대기"}</span></div>
    <section aria-label="자동 프로젝트 현황">
      <BriefText text={results?.currentStatus || analysis?.currentStatus || results?.summary || analysis?.summary || "점검·작업 결과가 도착하면 자동으로 정리합니다."} label="현재 상황 전체" />
      {(results?.nextAction || analysis?.nextAction) && <BriefText text={`다음 행동: ${results?.nextAction || analysis?.nextAction}`} label="다음 행동 전체" />}
      {analysis && !results && <p className={styles.detailFootnote}>AI 분석{monitor.error || analysis.basis !== monitor.inspection?.fingerprint ? " · 마지막 정상 분석, 최신 점검 필요" : ""}</p>}
    </section>
    <div className={styles.resultDisclosures}>
      <details className={styles.compactDisclosure}>
        <summary>수정·검증 <span>{results ? outcomes[results.outcome] : "결과 대기"}{results?.checks.some(c => c.status === "failed") ? " · 실패 있음" : results?.checks.some(c => c.status === "not_run") ? " · 미확인 있음" : ""}</span></summary>
        <section aria-label="자동 수정 검증 결과">
          {results ? <><BriefText text={results.summary} label="결과 요약 전체" />
            {results.changes.length > 0 && <details className={styles.compactDisclosure}><summary>변경 파일 {results.changes.length}개</summary><ul>{results.changes.map(path => <li key={path}>{path}</li>)}</ul></details>}
            {results.checks.length > 0 ? <ul>{results.checks.map((c, i) => <li key={i}><strong>{c.status === "passed" ? "통과" : c.status === "failed" ? "실패" : "미확인"} · {c.name}</strong><BriefText text={c.detail} label="검사 상세" /></li>)}</ul> : <p>코드 실행 검증 기록 없음</p>}
            {results.prUrl && <a href={results.prUrl} target="_blank" rel="noopener noreferrer">변경 PR·검증 기록 ↗</a>}
          </> : <p>수정 요청을 처리하면 변경 파일과 실제 검사 결과를 자동으로 기록합니다.</p>}
        </section>
      </details>
      {(["todo", "decision"] as const).map(kind => <details key={kind} className={styles.compactDisclosure}>
        <summary>{kind === "todo" ? "후속 업무" : "확인·결정할 사항"} <span>{tasksByKind[kind].length}건</span></summary>
        <section aria-label={kind === "todo" ? "자동 후속 업무" : "자동 확인 사항"}>
          {tasksByKind[kind].length ? <ul>{tasksByKind[kind].map(t => <li key={t.id}><BriefText text={t.title} label="업무 제목 전체" limit={120} /></li>)}</ul> : <p>현재 항목이 없습니다.</p>}
        </section>
      </details>)}
    </div>
  </section>;
}
