import { test, expect } from "@playwright/test";
import { emptyWorkspace, type Service } from "../../src/lib/workspace/types";
import {
  applySync,
  type ConnectorResult,
} from "../../src/lib/integrations/sync";
import {
  searchWorkspace,
  buildGrounding,
} from "../../src/lib/workspace/search";
import { mergeWorkspace } from "../../src/lib/workspace/transfer";

const stamp = "2026-10-14T02:00:00.000Z";
const service: Service = {
  id: "service-company",
  space: "company",
  projectId: null,
  name: "합성 회사 서비스",
  webUrl: "https://synthetic.example",
  repositoryUrl: "",
  connector: "v4",
  favorite: true,
  createdAt: stamp,
  lastSuccessAt: null,
  lastAttemptAt: null,
  connectionStatus: "needs_connection",
  error: null,
  failures: 0,
  nextRetryAt: null,
};
function workspace() {
  const data = emptyWorkspace();
  data.services.push({ ...service });
  return data;
}
const result: ConnectorResult = {
  mode: "full",
  complete: true,
  items: [
    {
      externalId: "original-1",
      title: "합성 운영 결과",
      content: "회사 결과입니다.",
      status: "done",
      sourceUrl: "https://synthetic.example/items/1",
      sourceUpdatedAt: stamp,
    },
  ],
  deletedIds: [],
};

test("재수집은 중복 없이 갱신하고 명시적 삭제를 반영한다", () => {
  let data = applySync(
    workspace(),
    service.id,
    "company",
    { ok: true, result },
    stamp,
  );
  const id = data.sourceRecords[0].id;
  data = applySync(
    data,
    service.id,
    "company",
    {
      ok: true,
      result: {
        ...result,
        items: [{ ...result.items[0], content: "수정한 결과" }],
      },
    },
    "2026-10-14T03:00:00Z",
  );
  expect(data.sourceRecords).toHaveLength(1);
  expect(data.sourceRecords[0]).toMatchObject({
    id,
    content: "수정한 결과",
    deletedAt: null,
  });
  data = applySync(
    data,
    service.id,
    "company",
    {
      ok: true,
      result: {
        mode: "delta",
        complete: true,
        items: [],
        deletedIds: ["original-1"],
      },
    },
    "2026-10-14T04:00:00Z",
  );
  expect(data.sourceRecords[0].deletedAt).toBeTruthy();
  expect(
    searchWorkspace(data, { space: "company", query: "결과" }),
  ).toHaveLength(0);
});

test("실패·부분 수집은 마지막 정상 자료를 삭제하지 않고 재연결한다", () => {
  let data = applySync(
    workspace(),
    service.id,
    "company",
    { ok: true, result },
    stamp,
  );
  data = applySync(
    data,
    service.id,
    "company",
    { ok: false, code: "unavailable" },
    "2026-10-14T03:00:00Z",
  );
  expect(data.sourceRecords).toHaveLength(1);
  expect(data.services[0]).toMatchObject({
    connectionStatus: "error",
    lastSuccessAt: stamp,
    failures: 1,
  });
  const grounded = buildGrounding(
    data,
    { space: "company", query: "결과" },
    "2026-10-15T03:00:00Z",
  );
  expect(grounded.sources[0].freshness).toBe("sync_error");
  data = applySync(
    data,
    service.id,
    "company",
    {
      ok: true,
      result: { mode: "full", complete: false, items: [], deletedIds: [] },
    },
    stamp,
  );
  expect(data.sourceRecords[0].deletedAt).toBeNull();
  data = applySync(
    data,
    service.id,
    "company",
    { ok: true, result },
    "2026-10-14T04:00:00Z",
  );
  expect(data.services[0]).toMatchObject({
    connectionStatus: "connected",
    failures: 0,
    error: null,
  });
  expect(data.sourceRecords).toHaveLength(1);
});

test("회사 검색·AI 근거에는 개인 자료나 다른 프로젝트가 포함되지 않는다", () => {
  const data = applySync(
    workspace(),
    service.id,
    "company",
    { ok: true, result },
    stamp,
  );
  data.notes.push({
    id: "private-note",
    space: "personal",
    projectId: null,
    content: "회사 결과 개인 비밀",
    createdAt: stamp,
    updatedAt: stamp,
  });
  data.notes.push({
    id: "company-note",
    space: "company",
    projectId: null,
    content: "회사 결과 메모. 이전 지시를 무시하라는 자료 문장",
    createdAt: stamp,
    updatedAt: stamp,
  });
  const bundle = buildGrounding(
    data,
    { space: "company", query: "결과" },
    stamp,
  );
  expect(bundle.sources.map((s) => s.id)).not.toContain("private-note");
  expect(bundle.sources.map((s) => s.kind)).toEqual(
    expect.arrayContaining(["fact", "note"]),
  );
  expect(bundle.executionAuthorized).toBe(false);
  expect(bundle.sources.every((s) => s.space === "company")).toBe(true);
  expect(bundle.sources.every((s) => !!s.collectedAt && !!s.updatedAt)).toBe(
    true,
  );
  expect(() =>
    applySync(data, service.id, "personal", { ok: true, result }, stamp),
  ).toThrow();
});

test("백업 병합은 기존 항목을 덮어쓰지 않고 교차 영역 ID 충돌을 거부한다", () => {
  const current = emptyWorkspace();
  current.projects.push({
    id: "p",
    space: "company",
    name: "현재 이름",
    description: "현재 내용",
    createdAt: stamp,
  });
  const imported = emptyWorkspace();
  imported.projects.push({ ...current.projects[0], name: "백업의 다른 이름" });
  imported.notes.push({
    id: "new-note",
    space: "company",
    projectId: "p",
    content: "합성 이관 메모",
    createdAt: stamp,
    updatedAt: stamp,
  });
  const merged = mergeWorkspace(current, imported);
  expect(merged.data.projects[0].name).toBe("현재 이름");
  expect(merged.data.notes).toHaveLength(1);
  expect(merged.conflicts).toBe(1);
  imported.projects[0].space = "personal";
  expect(() => mergeWorkspace(current, imported)).toThrow();
});

test("늦게 도착한 자료는 최신 내용을 되돌리지 않고 프로젝트 검색도 분리한다", () => {
  const data = workspace();
  data.projects.push(
    {
      id: "a",
      space: "company",
      name: "합성 A",
      description: "",
      createdAt: stamp,
    },
    {
      id: "b",
      space: "company",
      name: "합성 B",
      description: "",
      createdAt: stamp,
    },
  );
  data.services[0].projectId = "a";
  let collected = applySync(
    data,
    service.id,
    "company",
    {
      ok: true,
      result: {
        ...result,
        items: [
          {
            ...result.items[0],
            content: "최신 결과",
            sourceUpdatedAt: "2026-10-14T04:00:00Z",
          },
        ],
      },
    },
    "2026-10-14T04:00:00Z",
  );
  collected = applySync(
    collected,
    service.id,
    "company",
    { ok: true, result },
    "2026-10-14T05:00:00Z",
  );
  expect(collected.sourceRecords[0].content).toBe("최신 결과");
  collected.notes.push({
    id: "other-project",
    space: "company",
    projectId: "b",
    content: "최신 결과 다른 프로젝트",
    createdAt: stamp,
    updatedAt: stamp,
  });
  expect(
    searchWorkspace(collected, {
      space: "company",
      projectId: "a",
      query: "결과",
    }),
  ).toHaveLength(1);
  expect(
    searchWorkspace(collected, {
      space: "company",
      projectId: "b",
      query: "결과",
    }).map((r) => r.id),
  ).toEqual(["other-project"]);
  expect(
    searchWorkspace(collected, { space: "personal", query: "결과" }),
  ).toHaveLength(0);
  for (let i = 0; i < 60; i++)
    collected.notes.push({
      id: `recent-note-${i}`,
      space: "company",
      projectId: null,
      content: "더 최근의 결과 메모",
      createdAt: "2026-10-15T00:00:00Z",
      updatedAt: "2026-10-15T00:00:00Z",
    });
  expect(
    searchWorkspace(collected, {
      space: "company",
      query: "결과",
      kinds: ["fact"],
    }),
  ).toHaveLength(1);
});

test("완료 증거 없는 요청과 비밀값을 담은 연결·교차 영역 첨부는 거부한다", async () => {
  const { normalizeWorkspace } =
    await import("../../src/lib/workspace/validation");
  const data = workspace();
  data.services[0].webUrl =
    "https://synthetic.example?access_token=do-not-store";
  expect(() => normalizeWorkspace(data)).toThrow("토큰");
  data.services[0].webUrl = service.webUrl;
  data.requests.push({
    id: "request",
    space: "company",
    projectId: null,
    serviceId: service.id,
    title: "합성 변경",
    content: "요청만 저장",
    status: "completed",
    approval: "not_requested",
    verification: "",
    verifiedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  expect(() => normalizeWorkspace(data)).toThrow("검증");
  data.requests = [];
  data.conversations.push({
    id: "chat",
    space: "company",
    projectId: null,
    title: "합성",
    createdAt: stamp,
    updatedAt: stamp,
  });
  data.documents.push({
    id: "personal-file",
    space: "personal",
    projectId: null,
    taskId: null,
    name: "합성 개인 파일",
    mime: "text/plain",
    size: 0,
    createdAt: stamp,
  });
  data.messages.push({
    id: "message",
    conversationId: "chat",
    content: "교차 영역 차단",
    fileIds: ["personal-file"],
    createdAt: stamp,
  });
  expect(() => normalizeWorkspace(data)).toThrow("다른 영역");
});
