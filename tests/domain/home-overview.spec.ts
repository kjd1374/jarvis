import { test, expect } from "@playwright/test";
import { emptyWorkspace, type Project } from "../../src/lib/workspace/types";
import { homeRequests, homeScope } from "../../src/lib/workspace/home-overview";
import type { ProjectTurn } from "../../src/lib/automation/work-types";
const stamp = "2026-10-22T01:00:00.000Z", clock = Date.parse(stamp);
const project: Project = { id: "company-project", space: "company", name: "합성 회사 프로젝트", description: "합성 목표", createdAt: stamp };
function turn(id: string, changes: Partial<ProjectTurn> = {}): ProjectTurn {
  return { id, serviceId: "service", repository: "example/synthetic", request: "합성 기능 구현", mode: "change", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: stamp, updatedAt: stamp, ...changes };
}
const result = { reply: "합성 결과", summary: "검사", currentStatus: "완료", nextAction: "", changes: [], checks: [], followUps: [], outcome: "blocked" as const, branch: null, baseSha: null, headSha: null, prUrl: null, deployment: { state: "not_configured" as const, url: null, sha: null } };
test("업무실 요청은 회사/개인 및 선택 프로젝트 범위를 따르고 원본을 변경하지 않는다", () => {
  const data = emptyWorkspace();
  data.projects = [{ ...project, automation: { turns: [turn("company")] } }, { ...project, id: "other", automation: { turns: [turn("other")] } }, { ...project, space: "personal", id: "personal", automation: { turns: [turn("personal")] } }];
  const before = structuredClone(data);
  expect(homeRequests(homeScope(data).projects, clock).map(row => row.projectId)).toEqual(["company-project", "other"]);
  data.activeProjects.company = project.id;
  expect(homeRequests(homeScope(data).projects, clock).map(row => row.projectId)).toEqual([project.id]);
  data.activeSpace = "personal";
  expect(homeRequests(homeScope(data).projects, clock).map(row => row.projectId)).toEqual(["personal"]);
  expect(data.projects).toEqual(before.projects);
});
test("대기와 실제 실행을 구분하고 임대가 없거나 만료된 요청을 실행 중으로 단정하지 않는다", () => {
  const rows = homeRequests([{ ...project, automation: { turns: [turn("queued"), turn("live", { status: "running", phase: "coding", leaseUntil: "2026-10-22T01:01:00Z" }), turn("expired", { status: "running", leaseUntil: stamp }), turn("unknown", { status: "running" })] } }], clock);
  expect(rows.find(row => row.id.endsWith(":live"))).toMatchObject({ state: "running", label: "코드 수정 중" });
  expect(rows.find(row => row.id.endsWith(":queued"))).toMatchObject({ state: "queued", label: "실행 대기" });
  for (const id of ["expired", "unknown"]) expect(rows.find(row => row.id.endsWith(":" + id))).toMatchObject({ state: "attention", label: "실행 응답 확인 필요" });
});
test("상태 질문 답변은 이전 미완료 개발을 지우지 않고 실제 후속 구현 성공만 이전 실패를 대체한다", () => {
  const blocked = turn("blocked", { status: "completed", result });
  const answer = turn("answer", { status: "completed", createdAt: "2026-10-22T01:01:00Z", result: { ...result, outcome: "answered" } });
  expect(homeRequests([{ ...project, automation: { turns: [blocked, answer] } }], clock)).toHaveLength(1);
  const unchanged = { ...answer, id: "unchanged", result: { ...result, outcome: "no_changes" as const } };
  expect(homeRequests([{ ...project, automation: { turns: [blocked, unchanged] } }], clock)).toHaveLength(1);
  const success = turn("fixed", { status: "completed", createdAt: "2026-10-22T01:02:00Z", result: { ...result, outcome: "merged" } });
  expect(homeRequests([{ ...project, automation: { turns: [blocked, answer, success] } }], clock)).toEqual([]);
  expect(homeRequests([{ ...project, automation: { turns: [blocked, { ...success, serviceId: "another" }] } }], clock)).toHaveLength(1);
});
test("기획 실패와 개발 준비도 프로젝트 요청으로 남는다", () => {
  const p: Project = { ...project, planning: { document: { versionId: "synthetic", content: "합성", revision: 0, updatedAt: stamp, author: "user" }, history: [], turns: [{ id: "plan", request: "기획 요청", status: "failed", attempt: 1, createdAt: stamp, updatedAt: stamp }] }, setup: { id: "setup", status: "queued", target: "mac", database: "auto", createdAt: stamp, updatedAt: stamp, phase: "queued", attempt: 0, requests: [] } };
  expect(homeRequests([p], clock).map(row => row.state)).toEqual(["attention", "queued"]);
});

test("PR 검토와 실패한 검사는 완료 결과에 있어도 확인할 일로 표시한다", () => {
  const pr = turn("pr", { status: "completed", result: { ...result, outcome: "pr_open" } });
  const failed = turn("test", { mode: "test", status: "completed", result: { ...result, outcome: "answered", checks: [{ name: "검사", status: "failed", detail: "합성 실패" }] } });
  expect(homeRequests([{ ...project, automation: { turns: [pr, failed] } }], clock).map(row => row.label)).toEqual(["PR 검토 대기", "검사 결과 확인"]);
});
