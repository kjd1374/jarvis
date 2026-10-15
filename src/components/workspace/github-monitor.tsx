"use client";
import { useRef, useState } from "react";
import { actOnSuggestion, repositoryFor, requestInspection } from "@/lib/automation/state";
import { dateLabel, now, spaceLabels, type Service } from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import styles from "./studio.module.css";
const errors: Record<string, string> = {
  github_auth_required: "실행기에서 gh auth login으로 저장소 읽기 권한을 확인해주세요.",
  github_rate_limited: "GitHub 조회 한도에 도달했습니다. 잠시 후 다시 시도합니다.",
  github_unavailable: "GitHub 조회를 마치지 못했습니다. 마지막 정상 자료는 유지합니다.",
  cli_login_required: "실행기에서 codex login으로 ChatGPT 구독 로그인을 확인해주세요. API로 전환하지 않았습니다.",
  cli_limit: "구독의 Codex 사용 한도에 도달했습니다. 한도 복구 후 다시 점검해주세요.",
  cli_unavailable: "구독 CLI 실행 상태·버전을 확인해주세요. 수집한 자료는 유지합니다.",
  invalid_analysis: "분석의 형식·근거를 확인하지 못했습니다. 이전 결과는 유지합니다.",
};
export function GitHubMonitor({ service }: { service: Service }) {
  const { mutate, saving } = useWorkspace();
  const clock = useWorkspaceClock();
  const repository = repositoryFor(service);
  const monitor = service.monitoring;
  const job = monitor?.job;
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState<string[]>([]);
  const pending = useRef(false);
  if (!repository) return null;
  const current = monitor?.repository === repository;
  const inspection = current && monitor?.inspection?.repository === repository ? monitor.inspection : null;
  const analysis = current ? monitor?.analysis : null;
  const busy = job?.status === "queued" || job?.status === "running" && Date.parse(job.leaseUntil ?? "") > clock;
  const freshAnalysis = !!analysis && !monitor?.error && analysis.basis === inspection?.fingerprint && analysis.headSha === inspection.headSha && clock - Date.parse(inspection.inspectedAt) <= 86_400_000;
  async function run(action: () => Promise<void>) {
    if (pending.current || saving) return;
    pending.current = true;
    try { await action(); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { pending.current = false; }
  }
  return (
    <section aria-label={`${service.name} GitHub 점검`} className={`${styles.revisionDetails} ${styles.githubMonitoring}`}>
      <h4>GitHub 점검 · {repository}</h4>
      <p className={styles.detailFootnote}>
        {job?.status === "running" ? job.phase === "collect" ? "실행기가 저장소 자료를 읽는 중입니다." : "구독 CLI가 분석 중입니다."
          : job?.status === "queued" ? "점검 요청 저장됨 · 연결된 실행기가 가져가기를 기다립니다."
          : inspection ? "저장소 읽기 자료가 있습니다." : "아직 저장소 내용을 읽지 않았습니다."}
        {job?.status === "failed" && ` ${errors[job.error ?? ""] ?? "점검을 마치지 못했습니다. 다시 시도해주세요."}`}
      </p>
      <div className={styles.projectActions}>
        <button className={styles.secondaryButton} disabled={saving || busy} onClick={() => void run(async () => {
          await mutate(d => ({ ...d, services: d.services.map(s => s.id === service.id && s.space === service.space ? requestInspection(s, now()) : s) }));
        })}>{busy ? "점검 대기·진행 중" : inspection ? "GitHub 다시 점검" : "저장소 점검 시작"}</button>
        <a href="/settings#cli-runner" className={styles.textButton}>구독 CLI 실행기 연결</a>
      </div>
      {monitor && <label className={styles.confirmation}>
        <input type="checkbox" checked={monitor.automatic} disabled={saving} onChange={event => {
          const automatic = event.target.checked;
          void run(async () => { await mutate(d => ({ ...d, services: d.services.map(s => s.id === service.id && s.monitoring ? { ...s, monitoring: { ...s.monitoring, automatic } } : s) })); });
        }} />실행기가 켜져 있을 때 15분 간격으로 변경 조회
      </label>}
      <p className={styles.detailFootnote}>코드·이슈·PR·검증·배포 기록을 읽습니다. 웹 서비스의 업무 데이터 연동이나 외부 코드 수정은 별도입니다.</p>
      {inspection && <p className={styles.detailFootnote}>
        기준 {dateLabel(inspection.inspectedAt)} · {inspection.branch} / {inspection.headSha.slice(0, 8)}<br />
        파일 구조 {inspection.filesTotal}개 · 내용 확인·미변경 재확인 {inspection.reviewedPaths.length}개 · 제외 {inspection.excludedFiles}개
      </p>}
      {analysis ? <div className={styles.detailEmpty}>
        <span className={styles.detailBadge}>AI의 판단 · {analysis.provider === "codex" ? "Codex CLI" : "Claude Code"}</span>
        {!freshAnalysis && <p className={styles.formError}>마지막 정상 분석입니다. 현재 자료·연결 상태를 다시 확인한 뒤 제안을 채택해주세요.</p>}
        <p>{analysis.summary}</p>
        <p>현재 판단: {analysis.currentStatus}</p><p>다음 행동 제안: {analysis.nextAction}</p>
        <p className={styles.detailFootnote}>분석 {dateLabel(analysis.generatedAt)} · 근거 SHA {analysis.headSha.slice(0, 8)}</p>
        <details className={styles.revisionDetails}><summary>분석 근거와 확인 범위</summary>
          {analysis.citations.map(source => projectHref(source.sourceUrl) ?
            <p key={source.id}><a href={projectHref(source.sourceUrl)!} target="_blank" rel="noopener noreferrer">{source.title}</a> · 원본 {dateLabel(source.sourceUpdatedAt)} · 수집 {dateLabel(source.collectedAt)}</p> : null)}
          {inspection?.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}
        </details>
        {analysis.suggestions.filter(s => s.state === "proposed").map(suggestion => <article key={suggestion.id} className={styles.detailSection}>
          <strong>{suggestion.title}</strong><p>{suggestion.reason}</p>
          <span className={styles.detailBadge}>{suggestion.kind === "completion" ? "완료 후보 · 확인 필요" : "다음 작업 제안 · 승인 대기"}</span>
          {suggestion.kind === "completion" && <label className={styles.confirmation}><input type="checkbox" checked={reviewed.includes(suggestion.id)} onChange={e => setReviewed(ids => e.target.checked ? [...ids, suggestion.id] : ids.filter(id => id !== suggestion.id))} />완료 조건과 근거를 직접 확인했습니다.</label>}
          <div className={styles.projectActions}>
            <button className={styles.secondaryButton} disabled={saving || !freshAnalysis || suggestion.kind === "completion" && !reviewed.includes(suggestion.id)} onClick={() => void run(async () => {
              await mutate(d => actOnSuggestion(d, service.space, service.id, suggestion.id, "adopt", reviewed.includes(suggestion.id), now()));
            })}>{suggestion.kind === "completion" ? "확인한 업무 완료로 기록" : "할 일로 채택"}</button>
            <button className={styles.textButton} disabled={saving} onClick={() => void run(async () => { await mutate(d => actOnSuggestion(d, service.space, service.id, suggestion.id, "dismiss", false, now())); })}>제안 제외</button>
          </div>
        </article>)}
        <p className={styles.detailFootnote}>제안 채택은 Jarvis의 할 일 등록입니다. 외부 서비스 수정·코드 실행 승인을 대신하지 않습니다.</p>
      </div> : <p className={styles.detailFootnote}>AI 분석 결과 없음 · 구독 로그인된 CLI 실행기가 연결돼야 실제 분석이 반영됩니다.</p>}
      {inspection && <details className={styles.revisionDetails}><summary>조회 범위·미확인 항목</summary>
        <p>파일 구조 응답: {inspection.treeComplete ? "완전 응답" : "일부 응답 · 전체 구조 미확인"}. 모든 파일을 읽거나 코드를 실행한 것은 아닙니다.</p>
        {inspection.limitations.map((text, index) => <p key={index}>{text}</p>)}
        <p>확인 파일: {inspection.reviewedPaths.join(", ")}</p>
      </details>}
      {!!monitor?.previousAnalyses.length && <details className={styles.revisionDetails}><summary>이전 AI 판단 · {monitor.previousAnalyses.length}건</summary>
        {[...monitor.previousAnalyses].reverse().map((previous, index) => <p key={`${previous.basis}:${index}`}>{dateLabel(previous.generatedAt)} · {previous.headSha.slice(0, 8)} · {previous.summary}</p>)}
      </details>}
      {error && <p role="alert" className={styles.formError}>{error}</p>}
    </section>
  );
}
export function CliRunnerSetup() {
  const { data, ready } = useWorkspace();
  const space = data.activeSpace, projectId = data.activeProjects[space];
  function download() {
    const projectIds = projectId ? [projectId] : [...new Set(data.services.filter(s => s.space === space && repositoryFor(s)).map(s => s.projectId))].slice(0, 20);
    if (!projectIds.length) return;
    const file = new Blob([JSON.stringify({ origin: window.location.origin, provider: "codex", scopes: [{ space, projectIds }] }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = "jarvis-runner.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const hasRepository = data.services.some(s => s.space === space && (!projectId || s.projectId === projectId) && repositoryFor(s));
  return <section className={styles.settingsCard} id="cli-runner" aria-label="구독 CLI 실행기">
    <h2>구독 CLI 실행기</h2>
    <p>ChatGPT 구독으로 로그인한 공식 Codex CLI가 읽기 전용 점검·분석을 수행합니다. API 결제나 구독 인증값의 웹 복사는 필요하지 않습니다. 구독 사용 한도는 적용됩니다.</p>
    <p>{spaceLabels[space]} · {projectId ? data.projects.find(p => p.id === projectId)?.name : "현재 등록된 프로젝트"}만 실행기에 연결합니다.</p>
    <ol><li>실행할 PC에 Node 24+, GitHub CLI, Codex CLI를 준비합니다.</li><li>터미널에서 <code>gh auth login</code>과 <code>codex login</code>을 확인합니다. Codex는 ChatGPT 로그인 방식을 사용합니다.</li>
      <li>아래 실행기와 설정 파일을 같은 폴더에 받습니다. 설정 파일에는 토큰이 없습니다.</li><li><code>node jarvis-runner.mjs --config jarvis-runner.json</code>을 실행하고, 표시되는 12자리 번호로 최초 기기 등록을 진행합니다.</li></ol>
    <div className={styles.projectActions}><a className={styles.secondaryButton} href="/jarvis-runner.mjs" download>실행기 파일 받기</a>
      <button className={styles.secondaryButton} disabled={!ready || !hasRepository} onClick={download}>현재 범위의 실행기 설정 받기</button></div>
    <p className={styles.detailFootnote}>macOS·Linux·WSL에서 사용합니다. PC와 실행기가 켜져 있어야 자동 조회됩니다. 중단 시 서버의 대기 작업·마지막 정상 자료는 유지합니다. 외부 코드 변경은 실행하지 않습니다.</p>
  </section>;
}
