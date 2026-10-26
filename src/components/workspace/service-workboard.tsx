"use client";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { businessStatus, serviceWorkroom } from "@/lib/workspace/service-workroom";
import { dateLabel, requestLabels } from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { HomeProjects } from "./home-projects";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./workspace-controls";
import { useWorkspaceClock } from "./use-workspace-clock";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import home from "./integrated-home.module.css";

type View = "work" | "projects" | "records";
const views: { id: View; label: string }[] = [{ id: "work", label: "확인할 일" }, { id: "projects", label: "프로젝트" }, { id: "records", label: "가져온 기록" }];
type Scope = ReturnType<typeof serviceWorkroom>;
function projectPath(id: string | null, fallback = "/tasks?view=records") { return id ? `/projects/${encodeURIComponent(id)}` : fallback; }
export function ServiceWorkboard() {
  const { data } = useWorkspace(), clock = useWorkspaceClock();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("work");
  const scope = useMemo(() => serviceWorkroom(data, selectedId, clock), [data, selectedId, clock]);
  return <section className={home.board} aria-label="서비스별 업무 현황">
    <aside className={home.serviceRail} aria-label="서비스 선택">
      <div className={home.railHeading}><h2>서비스</h2><span>{scope.services.length}</span></div>
      <nav className={home.serviceList} aria-label="서비스별 현황 선택">
        <button type="button" aria-pressed={!scope.service} onClick={() => setSelectedId(null)}><Icon name="grid" size={16} /><span><strong>전체 업무</strong><small>연결 없는 기록까지 함께</small></span></button>
        {scope.services.map(service => <button type="button" key={service.id} aria-label={`${service.name} 현황 보기`} aria-pressed={scope.service?.id === service.id} onClick={() => setSelectedId(service.id)}>
          <Icon name="link" size={16} /><span><strong>{service.name}</strong><small>{businessStatus(service, clock).label}</small></span>
        </button>)}
      </nav>
      {!scope.services.length && <p className={home.empty}>등록한 서비스가 없습니다. 전체 업무에서 기존 할 일과 프로젝트를 확인할 수 있습니다.</p>}
      <Link className={home.railManage} href="/settings#services">서비스 관리 <Icon name="arrow" size={13} /></Link>
    </aside>
    <ServiceDetail key={`${scope.space}:${scope.service?.id ?? "all"}`} scope={scope} clock={clock} view={view} setView={setView} />
  </section>;
}
function ServiceDetail({ scope, clock, view, setView }: { scope: Scope; clock: number; view: View; setView: (view: View) => void }) {
  const { service, projects, tasks, requests, jobs, records } = scope;
  const uid = useId(), refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [workPage, setWorkPage] = useState(0), [recordPage, setRecordPage] = useState(0), [recordId, setRecordId] = useState<string | null>(null);
  const status = service ? businessStatus(service, clock) : null;
  const href = service ? projectHref(service.webUrl) : null;
  const rows = [
    ...jobs.map(job => ({ id: `job:${job.id}`, title: job.title, detail: `${job.projectName} · 프로젝트 요청`, label: job.label, href: projectPath(job.projectId), priority: job.state === "attention" ? 0 : 2, stamp: job.updatedAt, state: job.state })),
    ...tasks.map(task => ({ id: `task:${task.id}`, title: task.title, detail: `${projects.find(project => project.id === task.projectId)?.name ?? "프로젝트 연결 없음"} · ${service ? "연결 프로젝트의 할 일" : "Jarvis 할 일"}${task.dueDate ? ` · ${task.dueDate}` : ""}`, label: task.status === "decision" ? "결정 필요" : task.dueDate && task.dueDate < scope.day ? "기한 지남" : task.dueDate === scope.day ? "오늘" : task.status === "in_progress" ? "진행 중" : "할 일", href: projectPath(task.projectId), priority: task.status === "decision" || task.dueDate && task.dueDate <= scope.day ? 0 : 3, stamp: task.createdAt, state: task.status === "decision" || task.dueDate && task.dueDate < scope.day ? "attention" : "task" })),
    ...requests.map(request => ({ id: `request:${request.id}`, title: request.title, detail: request.serviceId ? "이 서비스의 수정 요청" : "연결 프로젝트의 수정 요청", label: requestLabels[request.status], href: projectPath(request.projectId, "/tasks?view=requests"), priority: ["failed", "awaiting_review"].includes(request.status) ? 0 : 3, stamp: request.updatedAt, state: ["failed", "awaiting_review"].includes(request.status) ? "attention" : "request" })),
  ].sort((a, b) => a.priority - b.priority || b.stamp.localeCompare(a.stamp));
  const selectedRecord = records.find(record => record.id === recordId);
  const workPages = Math.max(1, Math.ceil(rows.length / 5)), wp = Math.min(workPage, workPages - 1);
  const recordPages = Math.max(1, Math.ceil(records.length / 5)), rp = Math.min(recordPage, recordPages - 1);
  const counts = { work: rows.length, projects: projects.length, records: records.length };
  function changeTab(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault(); setView(views[next].id); refs.current[next]?.focus();
  }
  return <div className={home.serviceDetail}>
    <header className={home.detailHeader}>
      <div><h2>{service?.name ?? "전체 업무"}</h2><p>{service ? projects[0]?.name ?? "프로젝트 연결 없음" : `현재 영역의 서비스 ${scope.services.length}개와 프로젝트 ${projects.length}개`}</p></div>
      <div className={home.detailActions}>{href && <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${service!.name} 서비스 열기`}>서비스 열기 ↗</a>}<Link href="/settings#services">연결 관리</Link></div>
    </header>
    {status && <div className={home.sourceState} role="status" aria-label="업무 자료 상태" data-state={status.state}><span>{status.label}</span><p>{status.detail}{service?.lastSuccessAt ? ` 마지막 수집 ${dateLabel(service.lastSuccessAt)}` : ""}</p></div>}
    <div className={home.tabs} role="tablist" aria-label="서비스 업무 보기">
      {views.map((item, index) => <button type="button" key={item.id} id={`${uid}-${item.id}-tab`} ref={node => { refs.current[index] = node; }} role="tab" aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1} aria-controls={`${uid}-${item.id}-panel`} onClick={() => setView(item.id)} onKeyDown={event => changeTab(event, index)}>{item.label}<span>{counts[item.id]}</span></button>)}
    </div>
    <section className={home.panel} id={`${uid}-work-panel`} role="tabpanel" aria-labelledby={`${uid}-work-tab`} hidden={view !== "work"} tabIndex={0}>
      <p className={home.panelCaption}>Jarvis에 기록한 할 일·수정 요청과 프로젝트 실행 상태입니다.</p>
      {rows.length ? <ul className={home.rows}>{rows.slice(wp * 5, (wp + 1) * 5).map(row => <li key={row.id}><Link href={row.href} className={home.row}><div><strong>{row.title}</strong><small>{row.detail}</small></div><span className={home.badge} data-state={row.state}>{row.label}</span></Link></li>)}</ul> : <div className={home.emptyState}><Icon name="check" size={24} /><h3>현재 범위에 기록된 확인할 일이 없습니다.</h3><p>{service ? "다른 서비스나 전체 업무도 확인할 수 있습니다." : "할 일과 프로젝트 요청을 기록하면 이곳에서 이어갑니다."}</p></div>}
      <div className={home.panelFooter}><Link href="/tasks?view=records">업무 관리 →</Link>{workPages > 1 && <div><button type="button" disabled={wp === 0} onClick={() => setWorkPage(wp - 1)}>이전 업무</button><span>{wp + 1} / {workPages}</span><button type="button" disabled={wp + 1 === workPages} onClick={() => setWorkPage(wp + 1)}>다음 업무</button></div>}</div>
    </section>
    <section className={home.panel} id={`${uid}-projects-panel`} role="tabpanel" aria-labelledby={`${uid}-projects-tab`} hidden={view !== "projects"} tabIndex={0}><HomeProjects projects={projects} embedded /></section>
    <section className={home.panel} id={`${uid}-records-panel`} role="tabpanel" aria-labelledby={`${uid}-records-tab`} hidden={view !== "records"} tabIndex={0}>
      <p className={home.panelCaption}>서비스에서 가져온 원본 기록 · 마지막 수집 시각 기준</p>
      {records.length ? <ul className={home.rows}>{records.slice(rp * 5, (rp + 1) * 5).map(record => <li key={record.id}><button type="button" className={home.row} aria-label={`업무 기록 읽기: ${record.title}`} onClick={() => setRecordId(record.id)}><div><strong>{record.title}</strong><small>{scope.services.find(row => row.id === record.serviceId)?.name ?? "이전 서비스"} · 수집 {dateLabel(record.collectedAt)}</small></div><span className={home.badge}>{record.status || "수집 기록"}</span></button></li>)}</ul> : <div className={home.emptyState}><Icon name="link" size={24} /><h3>{status?.state === "needed" ? "업무 자료 연결이 필요합니다." : "가져온 업무 기록이 없습니다."}</h3><p>서비스 연결 상태를 확인해주세요. 등록한 주소와 Jarvis의 할 일은 계속 이용할 수 있습니다.</p><Link href="/settings#services">연결 관리 →</Link></div>}
      {recordPages > 1 && <div className={home.panelFooter}><span>저장한 기록 {records.length}개</span><div><button type="button" disabled={rp === 0} onClick={() => setRecordPage(rp - 1)}>이전 기록</button><span>{rp + 1} / {recordPages}</span><button type="button" disabled={rp + 1 === recordPages} onClick={() => setRecordPage(rp + 1)}>다음 기록</button></div></div>}
    </section>
    {selectedRecord && <Modal title="업무 기록 읽기" onClose={() => setRecordId(null)}><div className={styles.modalBody}><h3>{selectedRecord.title}</h3><p className={home.panelCaption}>원본 상태: {selectedRecord.status || "표시 없음"} · 수집 {dateLabel(selectedRecord.collectedAt)}</p><p className={home.recordBody}>{selectedRecord.content}</p>{projectHref(selectedRecord.sourceUrl) && <a className={styles.secondaryButton} href={projectHref(selectedRecord.sourceUrl)!} target="_blank" rel="noopener noreferrer">원본 자료 열기 ↗</a>}<button className={styles.secondaryButton} onClick={() => setRecordId(null)}>닫기</button></div></Modal>}
  </div>;
}
