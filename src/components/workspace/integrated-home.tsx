"use client";
import Link from "next/link";
import { today, spaceLabels, requestLabels } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { NotesPanel } from "./notes-panel";
import { ServicesPanel } from "./services-panel";
import { SourceResults, SourcesPanel } from "./sources-panel";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import { useWorkspaceClock } from "./use-workspace-clock";
export function IntegratedHome() {
  const clock = useWorkspaceClock();
  const { data, ready, error } = useWorkspace();
  const space = data.activeSpace;
  const projectId = data.activeProjects[space];
  const matches = (row: { space: string; projectId: string | null }) =>
    row.space === space && (!projectId || row.projectId === projectId);
  const tasks = data.tasks.filter((t) => matches(t) && t.status !== "done");
  const due = tasks
    .filter((t) => t.dueDate && t.dueDate <= today())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const decisions = tasks.filter((t) => t.status === "decision");
  const approvals = data.requests.filter(
    (r) => matches(r) && r.status === "awaiting_review",
  );
  const services = data.services.filter(matches);
  const proposals = services.flatMap(s => s.monitoring?.analysis?.suggestions.filter(p => p.state === "proposed").map(p => ({ ...p, service: s })) ?? []);
  const issues = services.filter(
    (s) =>
      s.monitoring?.enabled && (s.monitoring.error || !s.monitoring.lastSuccessAt || clock - Date.parse(s.monitoring.lastSuccessAt) > 86_400_000) || s.connector !== "shortcut" &&
      (s.connectionStatus !== "connected" ||
        !s.lastSuccessAt ||
        clock - Date.parse(s.lastSuccessAt) > 86_400_000),
  );
  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>YOUR WORK, CONNECTED</p>
          <h1>업무실</h1>
          <p>
            <strong>{spaceLabels[space]} 영역</strong> ·{" "}
            {projectId
              ? data.projects.find((p) => p.id === projectId)?.name
              : "전체 프로젝트"}
            의 현재 상황과 다음 행동을 확인하세요.
          </p>
        </div>
        <div className={styles.projectActions}>
          <Link className={styles.secondaryButton} href="/settings#connections">
            <Icon name="link" size={16} /> 연결 준비
          </Link>
          <Link className={styles.secondaryButton} href="/assistant">
            <Icon name="search" size={16} /> 자료 검색 · AI 질문
          </Link>
        </div>
      </div>
      {!ready ? (
        <div className={styles.loadState} role="status">
          <p>
            {error
              ? "기존 기록을 다시 불러와주세요."
              : "오늘의 업무와 연결 상태를 불러오는 중입니다."}
          </p>
        </div>
      ) : (
        <>
          <div className={styles.summaryGrid}>
            <Link className={styles.summaryCard} href="/tasks">
              <span className={styles.summaryIcon}>
                <Icon name="check" size={20} />
              </span>
              <div>
                <span>오늘 할 일</span>
                <strong>
                  {due.filter((t) => t.dueDate === today()).length}
                  <small>건</small>
                </strong>
              </div>
            </Link>
            <Link className={styles.summaryCard} href="/tasks">
              <span className={styles.summaryIcon}>
                <Icon name="clock" size={20} />
              </span>
              <div>
                <span>기한 지난 일</span>
                <strong>
                  {due.filter((t) => t.dueDate < today()).length}
                  <small>건</small>
                </strong>
              </div>
            </Link>
            <Link className={styles.summaryCard} href="#workroom-next-actions">
              <span className={styles.summaryIcon}>
                <Icon name="help" size={20} />
              </span>
              <div>
                <span>내 결정·승인 필요</span>
                <strong>
                  {approvals.length + proposals.length +
                    tasks.filter((t) => t.status === "decision").length}
                  <small>건</small>
                </strong>
              </div>
            </Link>
          </div>
          <div className={styles.projectDetailGrid}>
            <section
              className={styles.detailSection}
              aria-label="오늘의 다음 행동"
              id="workroom-next-actions"
            >
              <div className={styles.detailHeading}>
                <h2>오늘의 다음 행동</h2>
                <Link href="/tasks">업무 관리 →</Link>
              </div>
              {due.length ? (
                <ul className={styles.detailList}>
                  {due.slice(0, 6).map((task) => (
                    <li key={task.id}>
                      <Link
                        className={styles.actionRow}
                        href={
                          task.projectId
                            ? `/projects/${task.projectId}`
                            : "/tasks"
                        }
                      >
                        <div>
                          <strong>{task.title}</strong>
                          <span>
                            {task.dueDate} ·{" "}
                            {task.projectId
                              ? data.projects.find(
                                  (p) => p.id === task.projectId,
                                )?.name
                              : "영역 공통"}
                          </span>
                        </div>
                        <span
                          className={styles.detailBadge}
                          data-status={
                            task.dueDate < today() ? "failed" : task.status
                          }
                        >
                          {task.dueDate < today()
                            ? "기한 지남"
                            : task.status === "decision"
                              ? "결정 필요"
                              : "오늘"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.detailEmpty}>
                  오늘 기한인 업무가 없습니다. 할 일과 일정을 등록하면 이곳에
                  나타납니다.
                </p>
              )}
              {decisions.length > 0 && (
                <div className={styles.approvalList}>
                  <h3>내 판단이 필요한 업무</h3>
                  {decisions.slice(0, 4).map((task) => (
                    <Link
                      key={task.id}
                      href={
                        task.projectId
                          ? `/projects/${task.projectId}`
                          : "/tasks"
                      }
                    >
                      {task.title}
                      <span>결정 대기</span>
                    </Link>
                  ))}
                </div>
              )}
              {proposals.length > 0 && <div className={styles.approvalList}><h3>AI의 작업 제안 · 검토 필요</h3>
                {proposals.slice(0, 6).map(p => <Link key={`${p.service.id}:${p.id}`} href={p.service.projectId ? `/projects/${p.service.projectId}` : "/settings#services"}>{p.title}<span>근거 확인 후 채택</span></Link>)}
              </div>}
              {approvals.length > 0 && (
                <div className={styles.approvalList}>
                  <h3>검증·승인할 요청</h3>
                  {approvals.slice(0, 4).map((r) => (
                    <Link
                      key={r.id}
                      href={
                        r.projectId
                          ? `/projects/${r.projectId}`
                          : "/tasks?view=requests"
                      }
                    >
                      {r.title}
                      <span>{requestLabels[r.status]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <NotesPanel projectId={projectId} compact />
            <section
              className={styles.detailSection}
              aria-label="연결 오류와 오래된 자료"
            >
              <div className={styles.detailHeading}>
                <h2>연결 확인이 필요한 항목</h2>
                <span>{issues.length}개</span>
              </div>
              {issues.length ? (
                <ul className={styles.connectionIssues}>
                  {issues.map((s) => (
                    <li key={s.id}>
                      <strong>{s.name}</strong>
                      <p>
                        {s.monitoring?.error ? "GitHub 점검 연결을 확인해주세요." :
                          s.monitoring?.enabled && (!s.monitoring.lastSuccessAt || clock - Date.parse(s.monitoring.lastSuccessAt) > 86_400_000) ?
                          s.monitoring.lastSuccessAt ? "GitHub 자료가 24시간 이상 갱신되지 않았습니다." : "GitHub 점검 대기 · CLI 실행기를 연결해주세요." : s.error ||
                          (s.lastSuccessAt
                            ? "마지막 수집 이후 24시간 이상 지났습니다."
                            : "읽기 연결이 준비되지 않았습니다.")}
                      </p>
                      <small>마지막 정상 자료는 유지됩니다.</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.detailEmpty}>
                  {services.some((s) => s.connector !== "shortcut")
                    ? "연결 상태에 표시된 오류가 없습니다."
                    : "읽기 연동된 서비스가 아직 없습니다. 바로가기 등록과 자동 수집은 구분됩니다."}
                </p>
              )}
            </section>
            <ServicesPanel projectId={projectId ?? undefined} favoritesOnly />
          </div>
          <div className={styles.homeSection}>
            <SourceResults projectId={projectId ?? undefined} />
          </div>
          <details className={styles.homeDetails}>
            <summary>
              자료를 검색하고 AI 질문 준비하기 <Icon name="search" size={16} />
            </summary>
            <SourcesPanel projectId={projectId ?? undefined} />
          </details>
        </>
      )}
    </div>
  );
}
