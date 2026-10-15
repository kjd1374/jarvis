import { test, expect } from "@playwright/test";
import { emptyWorkspace, type Service, type Space } from "../../src/lib/workspace/types";
import { normalizeWorkspace } from "../../src/lib/workspace/validation";
import { duplicateConnection } from "../../src/lib/workspace/project-connections";
import { matchesPreset } from "../../src/lib/integrations/catalog";
const stamp = "2026-10-15T00:00:00.000Z";
const repository = "https://github.com/example/synthetic-repository";
const web = "https://synthetic.example.test/";
function fixture(space: Space = "company") {
  const data = emptyWorkspace();
  data.projects.push({ id: "p", space, name: "합성 프로젝트", description: "합성", createdAt: stamp, repositoryUrl: repository, serviceUrl: web });
  return data;
}
function service(overrides: Partial<Service> = {}): Service {
  return { id: "existing", space: "company", projectId: "p", name: "기존 웹", webUrl: web, repositoryUrl: repository,
    connector: "shortcut", favorite: true, createdAt: stamp, lastSuccessAt: null, lastAttemptAt: null,
    connectionStatus: "shortcut", error: null, failures: 0, nextRetryAt: null, ...overrides };
}
test("기존 웹·저장소 연결을 재사용하고 요청·수집 이력과 원본 주소를 보존한다", () => {
  const input = fixture();
  input.services.push(service());
  input.requests.push({ id: "r", space: "company", projectId: "p", serviceId: "existing", title: "합성 요청", content: "합성", status: "registered", approval: "not_requested", verification: "", verifiedAt: null, createdAt: stamp, updatedAt: stamp });
  input.syncEvents.push({ id: "e", space: "company", serviceId: "existing", attemptedAt: stamp, status: "success", code: "ok", received: 0 });
  input.sourceRecords.push({ id: "source", space: "company", projectId: "p", serviceId: "existing", externalId: "item", title: "합성 결과", content: "출처 사실", status: "done", sourceUrl: web, sourceUpdatedAt: stamp, collectedAt: stamp, deletedAt: null, taskId: null });
  const original = structuredClone(input);
  const unified = normalizeWorkspace(input);
  expect(unified.services).toEqual(original.services);
  expect(unified.requests).toEqual(original.requests);
  expect(unified.syncEvents).toEqual(original.syncEvents);
  expect(unified.sourceRecords).toEqual(original.sourceRecords);
  expect(unified.projects[0]).toMatchObject({ ...original.projects[0], connectionsUnified: true });
  expect(input).toEqual(original);
  expect(normalizeWorkspace(unified)).toEqual(unified);
});
test("상충하는 옛 주소와 회사·개인 연결은 덮어쓰거나 합치지 않는다", () => {
  const input = fixture();
  input.projects.push({ ...input.projects[0], id: "personal", space: "personal" });
  input.services.push(service({ repositoryUrl: "https://github.com/example/other-repository" }));
  const unified = normalizeWorkspace(input);
  expect(unified.services).toHaveLength(4);
  expect(unified.services[0]).toEqual(input.services[0]);
  expect(unified.services.filter(s => s.space === "personal")).toHaveLength(2);
  expect(new Set(unified.services.map(s => s.id)).size).toBe(4);
  expect(normalizeWorkspace(input).services.map(s => s.id)).toEqual(unified.services.map(s => s.id));
  expect(unified.services.slice(1).every(s => s.lastSuccessAt === null && s.connectionStatus === "shortcut")).toBe(true);
});
test("같은 GitHub의 .git·대소문자·끝 슬래시를 재사용하고 기존 ID 충돌도 보존한다", () => {
  const input = fixture();
  input.services.push(service({ webUrl: repository.toUpperCase().replace("HTTPS", "https") + ".git/", repositoryUrl: "" }));
  expect(normalizeWorkspace(input).services).toHaveLength(2);
  const generatedId = normalizeWorkspace(fixture()).services[0].id;
  const collision = fixture();
  collision.services.push(service({ id: generatedId, webUrl: "https://other.example.test/", repositoryUrl: "" }));
  const result = normalizeWorkspace(collision);
  expect(result.services).toHaveLength(3);
  expect(result.services[0]).toEqual(collision.services[0]);
  expect(new Set(result.services.map(s => s.id)).size).toBe(3);
});
test("공통 목록에서 변경한 주소를 보존하고 보관본의 옛 주소를 되살리지 않는다", () => {
  const unified = normalizeWorkspace(fixture());
  const oldIds = unified.services.map(s => s.id);
  const edited = { ...unified, services: unified.services.map(s => ({ ...s, webUrl: "https://new.example.test/", repositoryUrl: "" })) };
  const result = normalizeWorkspace(edited);
  expect(result.services.map(s => s.id)).toEqual(oldIds);
  expect(result.services.every(s => s.webUrl === "https://new.example.test/")).toBe(true);
  expect(result.projects[0].repositoryUrl).toBe(repository);
  expect(normalizeWorkspace({ ...edited, services: [] }).services).toEqual([]);
});
test("GitHub 포함 웹 서비스도 같은 설정 목록으로 분류하며 새 중복만 차단한다", () => {
  const combined = service();
  const repoOnly = service({ id: "new", webUrl: repository + ".git/", repositoryUrl: "" });
  expect(matchesPreset(combined, "github")).toBe(true);
  expect(duplicateConnection(combined, repoOnly)).toBe(true);
  expect(duplicateConnection(combined, { ...repoOnly, space: "personal" })).toBe(false);
  expect(duplicateConnection(combined, { ...repoOnly, projectId: null })).toBe(false);
  expect(duplicateConnection(combined, { ...combined, webUrl: "https://staging.example.test/" })).toBe(false);
  expect(matchesPreset({ ...combined, repositoryUrl: "https://github.com/example/repo?token=synthetic", webUrl: "https://example.test/" }, "github")).toBe(false);
});
test("잘못된 옛 주소는 실행 가능한 연결로 만들지 않고 보관한다", () => {
  const input = fixture();
  input.projects[0].repositoryUrl = "javascript:alert(1)";
  input.projects[0].serviceUrl = "https://example.test/?token=synthetic";
  const unified = normalizeWorkspace(input);
  expect(unified.services).toEqual([]);
  expect(unified.projects[0]).toMatchObject(input.projects[0]);
  expect(() => normalizeWorkspace({ ...input, projects: [{ ...input.projects[0], connectionsUnified: false }] })).toThrow();
});
