"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { enqueueWork } from "@/lib/automation/work";
import { repositoryFor } from "@/lib/automation/state";
import { dateLabel, id, now, type Project } from "@/lib/workspace/types";
import type { WorkPreview } from "@/lib/automation/work-types";
import { useWorkspace } from "./workspace-provider";
import { useWorkspaceClock } from "./use-workspace-clock";
import styles from "./studio.module.css";

export function PreviewResult({ preview }: { preview: WorkPreview }) {
  const clock = useWorkspaceClock();
  const expired = !!preview.expiresAt && Date.parse(preview.expiresAt) <= clock;
  return <div aria-label="화면 준비 결과" className={styles.screenResult}>
    <strong>{expired ? "미리보기 시간 만료" : preview.state === "ready" ? preview.kind === "mac" ? "맥미니 미리보기 준비됨" : "웹 배포 확인됨" : "화면 준비 필요"}</strong>
    {preview.state === "ready" && !expired && preview.url && <a className={styles.primaryButton} href={preview.url} target="_blank" rel="noopener noreferrer">
      {preview.kind === "mac" ? "맥미니에서 화면 열기 ↗" : "이 버전의 웹 화면 열기 ↗"}
    </a>}
    <p>{expired ? "화면 준비를 다시 누르면 현재 코드로 새 미리보기를 준비합니다." : preview.message}</p>
    <small>코드 {preview.sha.slice(0, 8)} · 확인 {dateLabel(preview.checkedAt)}{preview.expiresAt ? ` · 종료 ${dateLabel(preview.expiresAt)}` : ""}</small>
  </div>;
}

export function ProjectScreen({ project }: { project: Project }) {
  const { data, mutate, saving } = useWorkspace();
  const services = data.services.filter(s => s.space === project.space && s.projectId === project.id && repositoryFor(s));
  const [selected, setSelected] = useState(services[0]?.id ?? "");
  const service = services.find(s => s.id === selected) ?? services[0];
  const [error, setError] = useState("");
  const pending = useRef(false), requestId = useRef(id());
  const turns = (project.automation?.turns ?? []).filter(t => t.serviceId === service?.id && t.repository === (service && repositoryFor(service)));
  const latest = [...turns].reverse().find(t => t.result?.preview);
  const waiting = turns.some(t => t.mode === "preview" && ["queued", "running"].includes(t.status));
  async function prepare() {
    if (!service || pending.current || saving || waiting) return;
    pending.current = true; setError("");
    try {
      await mutate(d => enqueueWork(d, project.space, project.id, service.id, "현재 저장소의 웹 화면을 준비해주세요.", "preview", "pr", now(), requestId.current));
      requestId.current = id();
    } catch (e) { setError(e instanceof Error ? e.message : "화면 준비 요청을 저장하지 못했습니다."); }
    finally { pending.current = false; }
  }
  return <section className={`${styles.detailSection} ${styles.projectScreen}`} aria-label="수정된 화면 확인">
    <div className={styles.detailHeading}><h2>수정된 화면 확인</h2>
      <button className={styles.secondaryButton} onClick={prepare} disabled={saving || !service || waiting}>{waiting ? "화면 준비 대기·진행 중" : "화면 준비"}</button>
    </div>
    {services.length > 1 && <label>화면을 볼 저장소<select aria-label="화면을 볼 저장소" value={service?.id ?? ""} onChange={e => setSelected(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{repositoryFor(s)}</option>)}</select></label>}
    {latest?.result?.preview ? <PreviewResult preview={latest.result.preview} /> : <p>현재 코드의 배포 주소를 확인합니다. 배포가 없으면 맥미니에서 미리보기를 실행합니다. AI 사용량은 소모하지 않습니다.</p>}
    {waiting && <p role="status">요청을 저장했습니다. 미리보기를 지원하는 맥미니 실행기가 처리하면 화면 열기 버튼이 표시됩니다.</p>}
    <details className={styles.compactDisclosure}><summary>맥미니 미리보기 이용 안내</summary>
      <p>미리보기는 실행한 맥미니의 브라우저에서 열며 2시간 후 종료됩니다. 맥미니·실행기·Docker가 켜져 있어야 합니다. 다른 기기에서는 기존 웹 배포 주소를 사용하세요.</p>
      <p>별도의 임시 데이터로 화면을 확인합니다. 실제 AI·업무 서비스 연결과 운영 배포는 별도로 확인합니다. 정적 웹 또는 npm start가 있는 Node 앱을 지원하며, 다른 실행 방식이나 비밀 설정이 필요하면 이유를 표시합니다.</p>
      <Link href="/settings#cli-runner">맥미니 실행기 설정 →</Link>
    </details>
    {error && <p role="alert" className={styles.formError}>{error}</p>}
  </section>;
}
