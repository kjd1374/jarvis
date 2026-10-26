import { test, expect } from "@playwright/test";
import { emptyWorkspace, type Service, type SourceRecord } from "../../src/lib/workspace/types";
import { businessStatus, serviceWorkroom } from "../../src/lib/workspace/service-workroom";
import type { ProjectTurn } from "../../src/lib/automation/work-types";
const at = "2026-10-26T01:00:00.000Z", clock = Date.parse(at);
function service(id: string, projectId: string | null, space: "company" | "personal" = "company"): Service {
  return { id, projectId, space, name: id, webUrl: "https://service.example.test/", repositoryUrl: "", connector: "shortcut", favorite: false, createdAt: at, lastSuccessAt: null, lastAttemptAt: null, connectionStatus: "shortcut", error: null, failures: 0, nextRetryAt: null };
}
function record(id: string, serviceId: string, space: "company" | "personal" = "company"): SourceRecord {
  return { id, serviceId, space, projectId: space === "company" ? "shared" : "private", externalId: id, title: id, content: "합성 원본 기록", status: "검토", sourceUrl: "https://service.example.test/record", sourceUpdatedAt: at, collectedAt: at, deletedAt: null, taskId: null };
}
function fixture() {
  const data = emptyWorkspace();
  data.projects = ["shared", "other", "private"].map(id => ({ id, space: id === "private" ? "personal" as const : "company" as const, name: id, description: "합성", createdAt: at }));
  data.services = [service("a", "shared"), service("b", "shared"), service("unlinked", null), service("secret", "private", "personal")];
  data.tasks = ["shared", "other", "private", null].map((projectId, n) => ({ id: `task-${n}`, projectId, space: projectId === "private" ? "personal" as const : "company" as const, title: `합성 ${n}`, status: "todo" as const, dueDate: "", createdAt: at }));
  const turn = (id: string): ProjectTurn => ({ id, serviceId: id, repository: "example/synthetic", request: `${id} 합성 요청`, mode: "change", publish: "pr", status: "queued", phase: "queued", attempt: 0, createdAt: at, updatedAt: at });
  data.projects[0].automation = { turns: [turn("a"), turn("b")] };
  data.sourceRecords = [record("record-a", "a"), record("record-b", "b"), record("secret-record", "secret", "personal"), { ...record("deleted", "a"), deletedAt: at }];
  data.requests = ["a", "b", null].map((serviceId, n) => ({ id: `request-${n}`, serviceId, projectId: "shared", space: "company", title: "합성 수정 요청", content: "합성", status: "awaiting_review", approval: "pending", verification: "", verifiedAt: null, createdAt: at, updatedAt: at }));
  data.activeProjects.company = "other";
  return data;
}
test("전체 업무는 저장된 프로젝트 선택과 무관하게 현재 영역의 연결 없는 기록까지 보존한다", () => {
  const data = fixture(), before = structuredClone(data), result = serviceWorkroom(data, null, clock);
  expect(result.tasks.map(row => row.id)).toEqual(["task-0", "task-1", "task-3"]);
  expect(result.projects.map(row => row.id)).toEqual(["shared", "other"]);
  expect(result.services.map(row => row.id)).not.toContain("secret");
  expect(result.records.map(row => row.id)).toEqual(["record-a", "record-b"]);
  expect(data).toEqual(before);
});
test("같은 프로젝트의 서비스도 원본 기록과 실행 요청을 서로 섞지 않는다", () => {
  const result = serviceWorkroom(fixture(), "a", clock);
  expect(result.projects.map(row => row.id)).toEqual(["shared"]);
  expect(result.tasks.map(row => row.id)).toEqual(["task-0"]);
  expect(result.jobs.map(row => row.serviceId)).toEqual(["a"]);
  expect(result.requests.map(row => row.serviceId)).toEqual(["a", null]);
  expect(result.records.map(row => row.id)).toEqual(["record-a"]);
});
test("프로젝트 없는 서비스에 연결 없는 할 일을 임의로 귀속시키지 않는다", () => {
  const result = serviceWorkroom(fixture(), "unlinked", clock);
  expect(result.tasks).toEqual([]); expect(result.projects).toEqual([]); expect(result.records).toEqual([]);
});
test("다른 서비스 실행에서 만들어진 할 일을 공통 프로젝트의 직접 기록으로 다시 표시하지 않는다", () => {
  const data = fixture();
  data.tasks.push({ ...data.tasks[0],id:"derived-b",title:"다른 서비스의 실행 요청",sourceMessageId:"b" });
  expect(serviceWorkroom(data,"a",clock).tasks.map(row => row.id)).toEqual(["task-0"]);
  data.projects[0].automation!.turns[1].status = "completed";
  expect(serviceWorkroom(data,"a",clock).tasks.map(row => row.id)).toEqual(["task-0"]);
});
test("개인 영역 전환과 유효하지 않은 서비스 선택은 다른 영역의 기록을 반환하지 않는다", () => {
  const data = fixture(); data.activeSpace = "personal";
  const result = serviceWorkroom(data, "a", clock);
  expect(result.service).toBeNull(); expect(result.tasks.map(row => row.id)).toEqual(["task-2"]);
  expect(result.records.map(row => row.id)).toEqual(["secret-record"]); expect(result.services.map(row => row.id)).toEqual(["secret"]);
});
test("등록 주소와 코드 저장소는 업무 데이터 수집 성공을 뜻하지 않는다", () => {
  const s = { ...service("a", null), repositoryUrl: "https://github.com/example/synthetic", lastSuccessAt: at };
  expect(businessStatus(s, clock).state).toBe("needed");
  const connected = { ...s, connector: "v4" as const, connectionStatus: "connected" as const };
  expect(businessStatus(connected, clock).state).toBe("ready");
  expect(businessStatus(connected, clock + 86_400_001).state).toBe("stale");
});
test("수집 실패는 마지막 정상 원본을 숨기지 않으며 표시를 위해 기록을 수정하지 않는다", () => {
  const data = fixture(); data.services[0].connectionStatus = "error";
  const before = structuredClone(data), result = serviceWorkroom(data, "a", clock);
  expect(businessStatus(result.service!, clock).state).toBe("error");
  expect(result.records.map(row => row.id)).toEqual(["record-a"]); expect(data).toEqual(before);
});
