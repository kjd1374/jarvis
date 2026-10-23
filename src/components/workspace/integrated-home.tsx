"use client";
import Link from "next/link";
import { today, spaceLabels, dateLabel } from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { homeRequests, homeScope } from "@/lib/workspace/home-overview";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { NotesPanel } from "./notes-panel";
import { ServicesPanel } from "./services-panel";
import { SourceResults, SourcesPanel } from "./sources-panel";
import { HomeProjects } from "./home-projects";
import { Icon } from "./icon";
import { useWorkspaceClock } from "./use-workspace-clock";
import styles from "./studio.module.css";
import home from "./integrated-home.module.css";

export function IntegratedHome() {
  const clock = useWorkspaceClock(), { data, ready, error } = useWorkspace();
  const { space, projectId, projects } = homeScope(data);
  const matches = (row: { space: string; projectId: string | null }) => row.space === space && (!projectId || row.projectId === projectId);
  const tasks = data.tasks.filter(task => matches(task) && task.status !== "done");
  const due = tasks.filter(task => task.dueDate && task.dueDate <= today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const jobs = homeRequests(projects, clock);
  const workIds = new Set(projects.flatMap(project => project.automation?.turns.map(turn => turn.id) ?? []));
  const decisions = tasks.filter(task => task.status === "decision" && (!task.sourceMessageId || !workIds.has(task.sourceMessageId)));
  const approvals = data.requests.filter(request => matches(request) && request.status === "awaiting_review");
  const services = data.services.filter(matches);
  const proposals = services.flatMap(service => service.monitoring?.analysis?.suggestions.filter(proposal => proposal.state === "proposed").map(proposal => ({ ...proposal, service })) ?? []);
  const issues = services.filter(service => service.monitoring?.enabled && (service.monitoring.error || !service.monitoring.lastSuccessAt || clock - Date.parse(service.monitoring.lastSuccessAt) > 86_400_000) || service.connector !== "shortcut" &&
    (service.connectionStatus !== "connected" || !service.lastSuccessAt || clock - Date.parse(service.lastSuccessAt) > 86_400_000));
  const favorites = services.some(service => service.favorite) ? services.filter(service => service.favorite) : services;
  const attention = jobs.filter(job => job.state === "attention").length + decisions.length + approvals.length + proposals.length;
  const taskHref = (id: string | null) => id ? `/projects/${id}` : "/tasks?view=records";
  const jobList = (rows: typeof jobs) => <ul className={home.rows}>{rows.map(job => <li key={job.id}>
    <Link href={`/projects/${job.projectId}`} className={home.row}>
      <div><strong>{job.title}</strong><small>{job.projectName} · {dateLabel(job.updatedAt)}</small></div>
      <span className={home.badge} data-state={job.state}>{job.label}</span>
    </Link>
  </li>)}</ul>;
  return <div className={styles.studio}>
    <WorkspaceControls />
    <div className={home.home}>
      <header className={home.heading}>
        <div><h1>업무실</h1><p>{spaceLabels[space]} · {projects.find(project => project.id === projectId)?.name ?? "전체 프로젝트"}</p></div>
        <nav className={home.sectionNav} aria-label="업무실 바로가기">
          <a href="#home-notes">메모</a><a href="#workroom-next-actions">할 일</a><a href="#home-projects">프로젝트</a><a href="#home-services">서비스</a>
        </nav>
      </header>
      {!ready ? <div className={styles.loadState} role="status"><p>{error ? "기존 기록을 다시 불러와주세요." : "업무실을 불러오는 중입니다."}</p></div> : <>
        <NotesPanel projectId={projectId} compact home />
        <div className={home.workGrid}>
        <section className={styles.detailSection} aria-label="오늘의 다음 행동" id="workroom-next-actions">
          <div className={styles.detailHeading}><h2><Icon name="check" size={17} /> 지금 확인할 일</h2><Link href="/tasks?view=records">업무 관리 →</Link></div>
          <div className={home.metrics} aria-label="업무 요약">
            <Link href="/tasks?view=records">오늘 할 일<strong>{due.filter(task => task.dueDate === today()).length}</strong></Link>
            <Link href="/tasks?view=records">기한 지난 일<strong>{due.filter(task => task.dueDate < today()).length}</strong></Link>
            <a href="#home-project-requests">실행 중·대기<strong>{jobs.filter(job => job.state !== "attention").length}</strong></a>
            <a href="#home-project-requests">확인 필요<strong>{attention}</strong></a>
          </div>
          <div className={home.nextColumns}>
            <div id="home-project-requests"><h3>프로젝트 요청</h3>
              {jobs.length ? <>{jobList(jobs.slice(0, 4))}{jobs.length > 4 && <details className={styles.compactDisclosure}><summary>요청 {jobs.length - 4}개 더 보기</summary>{jobList(jobs.slice(4, 16))}{jobs.length > 16 && <Link href="/projects" className={home.more}>나머지 요청은 프로젝트에서 확인 →</Link>}</details>}</> : <p className={home.empty}>진행 중이거나 확인이 필요한 프로젝트 요청이 없습니다.</p>}
            </div>
            <div><h3>오늘의 업무·확인</h3>
              <ul className={home.rows}>
                {due.slice(0, 4).map(task => <li key={task.id}><Link href={taskHref(task.projectId)} className={home.row}>
                  <div><strong>{task.title}</strong><small>{task.dueDate}</small></div><span className={home.badge} data-state={task.dueDate < today() ? "attention" : undefined}>{task.dueDate < today() ? "기한 지남" : "오늘"}</span>
                </Link></li>)}
                {decisions.slice(0, 3).map(task => <li key={task.id}><Link href={taskHref(task.projectId)} className={home.row}><strong>{task.title}</strong><span className={home.badge} data-state="attention">결정 필요</span></Link></li>)}
                {approvals.slice(0, 3).map(request => <li key={request.id}><Link href={request.projectId ? `/projects/${request.projectId}` : "/tasks?view=requests"} className={home.row}><strong>{request.title}</strong><span className={home.badge} data-state="attention">결과 검토</span></Link></li>)}
                {proposals.slice(0, 3).map(proposal => <li key={`${proposal.service.id}:${proposal.id}`}><Link href={proposal.service.projectId ? `/projects/${proposal.service.projectId}` : "/settings#services"} className={home.row}><strong>{proposal.title}</strong><span className={home.badge}>AI 제안 · 검토</span></Link></li>)}
              </ul>
              {!due.length && !decisions.length && !approvals.length && !proposals.length && <p className={home.empty}>오늘 기한인 업무와 검토할 항목이 없습니다.</p>}
              {(due.length > 4 || decisions.length > 3 || approvals.length > 3) && <Link href="/tasks?view=records" className={home.more}>업무 전체 보기 →</Link>}
            </div>
          </div>
        </section>
        <HomeProjects projects={projects} />
        </div>
        <section className={styles.detailSection} aria-label="자주 쓰는 서비스" id="home-services">
          <div className={styles.detailHeading}><h2><Icon name="link" size={17} /> 자주 쓰는 서비스</h2><Link href="/settings#services">서비스 관리 →</Link></div>
          {favorites.length ? <div className={home.services}>{favorites.slice(0, 6).map(service => {
            const href = projectHref(service.webUrl);
            return href ? <a key={service.id} href={href} target="_blank" rel="noopener noreferrer" className={home.service} aria-label={`${service.name} 바로 열기`}>
              <Icon name="link" size={18} /><div><strong>{service.name}</strong><small>등록된 주소 열기</small></div><Icon name="arrow" size={14} />
            </a> : null;
          })}</div> : <p className={home.empty}>자주 사용하는 서비스 주소를 등록하면 바로 열 수 있습니다.</p>}
          {favorites.length > 6 && <Link href="/settings#services" className={home.more}>서비스 {favorites.length - 6}개 더 보기 →</Link>}
        </section>
        <nav className={home.tools} aria-label="업무실 도구">
          <Link href="/settings#connections"><Icon name="link" size={14} /> 연결 준비</Link>
          <Link href="/assistant"><Icon name="search" size={14} /> 자료 검색 · AI 질문</Link>
        </nav>
        <details className={home.diagnostics}><summary>서비스 관리·연결 기록</summary><ServicesPanel projectId={projectId ?? undefined} favoritesOnly /></details>
        <details className={home.diagnostics}><summary>최근 결과·연결 진단 {issues.length ? `· 확인 ${issues.length}개` : ""}</summary>
          <SourceResults projectId={projectId ?? undefined} />
          <section className={styles.detailSection} aria-label="연결 오류와 오래된 자료">
            <div className={styles.detailHeading}><h2>연결 확인이 필요한 항목</h2><span>{issues.length}개</span></div>
            {issues.length ? <ul className={styles.connectionIssues}>{issues.map(service => <li key={service.id}><strong>{service.name}</strong><p>{service.monitoring?.error ? "GitHub 점검 연결을 확인해주세요." : service.error || "마지막 수집 상태와 실행기 연결을 확인해주세요."}</p><small>마지막 정상 자료는 유지됩니다.</small></li>)}</ul> : <p className={home.empty}>연결 상태에 표시된 오류가 없습니다. 주소 등록과 데이터 읽기 연동은 구분됩니다.</p>}
          </section>
        </details>
        <details className={home.diagnostics}><summary>자료를 검색하고 AI 질문 준비하기</summary><SourcesPanel projectId={projectId ?? undefined} /></details>
      </>}
    </div>
  </div>;
}
