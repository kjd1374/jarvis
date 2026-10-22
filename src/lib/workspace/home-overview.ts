import type { Project, WorkspaceData } from "./types";

export type HomeRequest = {
  id: string; projectId: string; projectName: string; title: string; label: string;
  state: "running" | "queued" | "attention"; updatedAt: string;
};
const phases: Record<string, string> = { preparing: "저장소 확인 중", coding: "코드 수정 중", testing: "검사 중", publishing: "GitHub 반영 중", reporting: "결과 정리 중" };

// Read existing scoped records only. Opening the home never enqueues or retries work.
export function homeRequests(projects: Project[], clock: number): HomeRequest[] {
  const rows: HomeRequest[] = [];
  for (const project of projects) {
    const add = (kind: string, item: { id: string; status: string; updatedAt: string; leaseUntil?: string }, title: string, label: string, blocked = false, attentionLabel = "확인 필요") => {
      const expired = item.status === "running" && (!item.leaseUntil || Date.parse(item.leaseUntil) <= clock);
      const state = item.status === "queued" ? "queued" : item.status === "running" && !expired ? "running" : ["failed", "interrupted"].includes(item.status) || blocked || expired ? "attention" : null;
      if (state) rows.push({ id: `${project.id}:${kind}:${item.id}`, projectId: project.id, projectName: project.name, title,
        label: expired ? "실행 응답 확인 필요" : state === "attention" ? attentionLabel : state === "queued" ? "실행 대기" : label, state, updatedAt: item.updatedAt });
    };
    const turns = project.automation?.turns ?? [];
    const successful = new Map<string, number>();
    for (const turn of turns) if (turn.status === "completed" && turn.result && turn.result.outcome !== "blocked" && (turn.mode !== "change" || ["pr_open", "merged", "deployed"].includes(turn.result.outcome)) && !turn.result.checks.some(check => check.status === "failed")) {
      const key = `${turn.serviceId}:${turn.mode}`;
      successful.set(key, Math.max(successful.get(key) ?? 0, Date.parse(turn.createdAt)));
    }
    for (const turn of turns) {
      // A newer successful request of the same kind supersedes old failures.
      // An answered status question does not establish that development finished.
      const newer = (successful.get(`${turn.serviceId}:${turn.mode}`) ?? 0) > Date.parse(turn.createdAt);
      if (newer && !["queued", "running"].includes(turn.status)) continue;
      const kind = turn.mode === "preview" ? "화면 준비" : turn.mode === "test" ? "테스트" : turn.mode === "ask" ? "질문" : "개발 요청";
      const result = turn.result;
      const failed = result?.checks.some(check => check.status === "failed");
      const review = result?.outcome === "pr_open";
      const pending = result?.outcome === "merged" && ["pending", "failure"].includes(result.deployment.state);
      add("work", turn, turn.request, phases[turn.phase] ?? `${kind} 처리 중`,
        turn.status === "completed" && (result?.outcome === "blocked" || !!failed || review || pending),
        failed ? "검사 결과 확인" : review ? "PR 검토 대기" : pending ? "반영 결과 확인" : "확인 필요");
    }
    const plans = project.planning?.turns ?? [];
    for (const turn of plans) {
      if (!["queued", "running"].includes(turn.status) && plans.some(other => other.status === "completed" && Date.parse(other.createdAt) > Date.parse(turn.createdAt))) continue;
      add("plan", turn, turn.request, "기획안 작성 중");
    }
    if (project.setup) add("setup", project.setup, "개발 환경 준비", "개발 환경 준비 중");
    if (project.release) {
      add("release", project.release, "서비스 운영 전환", "운영 배포 중");
      if (project.release.status === "deployed" && !project.release.confirmedAt)
        rows.push({ id: `${project.id}:release-review`, projectId: project.id, projectName: project.name, title: "배포된 서비스의 기능을 확인해주세요.", label: "사용 확인 대기", state: "attention", updatedAt: project.release.updatedAt });
    }
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function homeScope(data: WorkspaceData) {
  const space = data.activeSpace, projectId = data.activeProjects[space];
  return { space, projectId, projects: data.projects.filter(p => p.space === space && (!projectId || p.id === projectId)) };
}
