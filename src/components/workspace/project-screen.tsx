"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { enqueueWork, latestWorkSource } from "@/lib/automation/work";
import { repositoryFor } from "@/lib/automation/state";
import { queuedWorkMessage } from "@/lib/automation/runner-status";
import { dateLabel, id, now, type Project } from "@/lib/workspace/types";
import type { WorkPreview } from "@/lib/automation/work-types";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import styles from "./studio.module.css";
const previewStages = { docker: "실행 서버 연결", build: "실행 환경 준비", application: "앱 응답", configuration: "Jarvis 연결 설정", provisioning: "임시 주소 발급", connection: "외부 연결", health: "외부 주소 응답", module: "실행 모듈", ai: "구독 CLI 응답" };
export function previewMessage(preview: WorkPreview) {
  return preview.state === "failed" && !preview.diagnostic && /실행기.*(?:업데이트|설치)/.test(preview.message)
    ? "이전 미리보기 준비 실패 기록입니다. 당시 상세 원인은 저장되지 않았습니다." : preview.message;
}

export function PreviewResult({ preview, project, turnId }: { preview: WorkPreview; project: Project; turnId: string }) {
  const clock = useWorkspaceClock();
  const expired = !!preview.expiresAt && Date.parse(preview.expiresAt) <= clock;
  const href = preview.kind === "remote" ? `/api/preview/open?${new URLSearchParams({ space: project.space, projectId: project.id, turnId })}` : preview.url;
  return <div aria-label="화면 준비 결과" className={styles.screenResult}>
    <strong>{expired ? "미리보기 시간 만료" : preview.state === "ready" ? preview.kind === "mac" ? "맥미니 전용 미리보기" : preview.kind === "remote" ? "원격 미리보기 준비됨" : "웹 배포 확인됨" : "화면 준비 필요"}</strong>
    {preview.state === "ready" && !expired && href && <a className={styles.primaryButton} href={href} target="_blank" rel="noopener noreferrer">
      {preview.kind === "mac" ? "맥미니에서만 열기 ↗" : preview.kind === "remote" ? "이 PC에서 화면 열기 ↗" : "이 버전의 웹 화면 열기 ↗"}
    </a>}
    <p>{expired ? "화면 준비를 다시 누르면 현재 코드로 새 미리보기를 준비합니다." : previewMessage(preview)}</p>
    {preview.ai && <p>구독 CLI 실제 응답 확인 · 안녕하세요 → {preview.ai.sample} · {dateLabel(preview.ai.verifiedAt)}</p>}
    {preview.diagnostic && <details className={styles.compactDisclosure}><summary>연결 진단</summary>
      <p>{previewStages[preview.diagnostic.stage]} · {preview.diagnostic.code}{preview.diagnostic.statusCode ? ` · HTTP ${preview.diagnostic.statusCode}` : ""}{preview.diagnostic.exitCode !== undefined ? ` · 종료 코드 ${preview.diagnostic.exitCode}` : ""}</p>
    </details>}
    {preview.kind === "mac" && preview.state === "ready" && preview.url && !expired && <p>이전 실행기가 만든 주소입니다. <Link href="/settings#cli-runner">맥미니 실행기를 업데이트</Link>한 뒤 화면 준비를 다시 누르면 다른 PC에서도 열 수 있습니다.</p>}
    <small>코드 {preview.sha.slice(0, 8)} · 확인 {dateLabel(preview.checkedAt)}{preview.expiresAt ? ` · 종료 ${dateLabel(preview.expiresAt)}` : ""}</small>
  </div>;
}

export function ProjectScreen({ project }: { project: Project }) {
  const { data, mutate, saving } = useWorkspace();
  const clock = useWorkspaceClock();
  const services = data.services.filter(s => s.space === project.space && s.projectId === project.id && repositoryFor(s));
  const [selected, setSelected] = useState(services[0]?.id ?? "");
  const service = services.find(s => s.id === selected) ?? services[0];
  const [error, setError] = useState("");
  const [revision, setRevision] = useState("latest");
  const [previewAI, setPreviewAI] = useState<"none" | "codex">([...project.automation?.turns ?? []].reverse().find(t => t.mode === "preview")?.previewAI ?? "none");
  const recent = service && latestWorkSource(project, service.id, repositoryFor(service)!);
  const source = revision === "latest" ? recent : undefined;
  const pending = useRef(false), requestId = useRef(id());
  const turns = (project.automation?.turns ?? []).filter(t => t.serviceId === service?.id && t.repository === (service && repositoryFor(service)));
  const latest = [...turns].reverse().find(t => t.result?.preview && (source ? t.id === source.id || t.sourceTurnId === source.id : !t.sourceTurnId && t.result.outcome !== "pr_open"));
  const waiting = turns.find(t => t.mode === "preview" && ["queued", "running"].includes(t.status));
  const testing = turns.find(t => t.mode === "test" && ["queued", "running"].includes(t.status));
  async function prepare(mode: "preview" | "test") {
    if (!service || pending.current || saving || (mode === "preview" ? waiting : testing)) return;
    pending.current = true; setError("");
    try {
      await mutate(d => enqueueWork(d, project.space, project.id, service.id, mode === "test" ? "선택한 코드의 자동 테스트를 실행해주세요." : "선택한 코드의 웹 화면을 준비해주세요.", mode, "pr", now(), requestId.current, source?.id, mode === "preview" && previewAI === "codex" ? "codex" : undefined));
      requestId.current = id();
    } catch (e) { setError(e instanceof Error ? e.message : "화면 준비 요청을 저장하지 못했습니다."); }
    finally { pending.current = false; }
  }
  return <section className={`${styles.detailSection} ${styles.projectScreen}`} aria-label="수정된 화면 확인">
    <div className={styles.detailHeading}><h2>수정된 화면 확인</h2>
      <div className={styles.agentTurnActions}>
        <button className={styles.secondaryButton} onClick={() => prepare("test")} disabled={saving || !service || !!testing}>{testing ? "테스트 대기·진행 중" : "테스트 실행"}</button>
        <button className={styles.secondaryButton} onClick={() => prepare("preview")} disabled={saving || !service || !!waiting}>{waiting ? "화면 준비 대기·진행 중" : "화면 준비"}</button>
      </div>
    </div>
    {services.length > 1 && <label>화면을 볼 저장소<select aria-label="화면을 볼 저장소" value={service?.id ?? ""} onChange={e => setSelected(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{repositoryFor(s)}</option>)}</select></label>}
    {recent && <label>확인할 코드<select aria-label="확인할 코드" value={revision} onChange={e => setRevision(e.target.value)}><option value="latest">최근 수정본 · PR 반영 대기</option><option value="main">기본 브랜치 · 반영된 코드</option></select></label>}
    {source && <p>최근 수정본 {source.result!.headSha!.slice(0, 8)}을 확인합니다. 기록상 반영 대기이며 실행할 때 GitHub 상태를 다시 확인합니다.</p>}
    <label>미리보기 AI<select aria-label="미리보기 AI" value={previewAI} onChange={e => setPreviewAI(e.target.value === "codex" ? "codex" : "none")}>
      <option value="none">연결 안 함 · 화면·저장 확인</option><option value="codex">현재 구독 CLI · 사용량 소모</option>
    </select></label>
    {previewAI === "codex" && <p>구독 CLI로 짧은 번역 응답을 실제 확인한 뒤 화면을 준비합니다. 요청마다 구독 사용량이 소모됩니다. API 키 과금으로 전환하지 않으며 임시 화면 한 개에서 최대 20회 요청할 수 있습니다.</p>}
    {latest?.result?.preview ? <PreviewResult preview={latest.result.preview} project={project} turnId={latest.id} /> : <p>{previewAI === "codex"
      ? "현재 코드의 임시 앱을 실행하고 구독 CLI의 번역 응답을 확인합니다. 준비가 끝나면 이 PC에서 열 수 있습니다."
      : "배포 주소가 없으면 맥미니에서 임시 화면을 준비합니다. AI는 연결하지 않습니다."}</p>}
    {waiting && <p role="status">화면 준비: {waiting.status === "queued" ? queuedWorkMessage(waiting, service?.monitoring, clock) : "실행기가 화면을 준비하고 있습니다. 완료되면 화면 열기 버튼이 표시됩니다."}</p>}
    {testing && <p role="status">자동 테스트: {testing.status === "queued" ? queuedWorkMessage(testing, service?.monitoring, clock) : "실행 중입니다. 결과는 아래 프로젝트 작업에 표시됩니다."}</p>}
    <details className={styles.compactDisclosure}><summary>맥미니 미리보기 이용 안내</summary>
      <p>자동 테스트는 실행 서버에서 처리합니다. 화면 표시, 자동 검증, 실제 AI·외부 서비스 연결은 각각 확인해야 합니다.</p>
      <p>승인된 Jarvis 기기에서 미리보기를 열 수 있으며 2시간 후 종료됩니다. 맥미니·실행기·Docker가 켜져 있어야 합니다. 노트북·데스크탑에는 실행기를 설치하지 않아도 됩니다.</p>
      <p>임시 화면은 Cloudflare의 HTTPS 연결을 거칩니다. 주소만 복사하면 열리지 않으므로 각 PC의 Jarvis에서 화면 열기를 눌러주세요.</p>
      <p>별도의 임시 데이터로 화면을 확인합니다. 구독 CLI를 선택하면 지원 앱의 AI 연결도 검사합니다. 업무 서비스 연결과 운영 배포는 별도로 확인합니다. 정적 웹과 지원하는 Node 앱을 실행하며, 다른 실행 방식이나 연결 설정이 필요하면 이유를 표시합니다.</p>
      <Link href="/settings#cli-runner">맥미니 실행기 설정 →</Link>
    </details>
    {error && <p role="alert" className={styles.formError}>{error}</p>}
  </section>;
}
