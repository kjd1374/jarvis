import { emptyWorkspace, type Service, type SourceRecord } from "../../src/lib/workspace/types";
import { enqueueWork } from "../../src/lib/automation/work";
import { createStagedProject } from "../../src/lib/projects/lifecycle";
export function serviceWorkroomFixture() {
  const at = new Date().toISOString();
  let data = emptyWorkspace();
  data.projects.push(
    { id: "service-project", space: "company", name: "합성 공통 프로젝트", description: "서비스 프로젝트의 다음 작업", stage: "development", createdAt: at },
    { id: "personal-project", space: "personal", name: "개인 전용 프로젝트", description: "개인 합성", stage: "development", createdAt: at },
  );
  data = createStagedProject(data, { space:"company",name:"연결 없는 합성 아이디어",description:"기획할 내용",stage:"idea" }, at, "other-project");
  function service(id: string, name: string, projectId: string | null, space: "company" | "personal" = "company"): Service {
    return { id, name, projectId, space, webUrl: `http://127.0.0.1:4317/api/health?service=${id}`, repositoryUrl: "https://github.com/example/synthetic", connector: "shortcut", favorite: true, createdAt: at, lastSuccessAt: null, lastAttemptAt: null, connectionStatus: "shortcut", error: null, failures: 0, nextRetryAt: null };
  }
  data.services.push(service("service-a", "합성 서비스 A", "service-project"), { ...service("service-b", "합성 서비스 B", "service-project"), connector: "v4", connectionStatus: "connected", lastSuccessAt: at }, { ...service("service-old", "합성 이전 자료 서비스", null), connector: "v4", connectionStatus: "error", lastSuccessAt: "2026-10-01T00:00:00Z", error: "합성 수집 실패" }, service("personal-service", "개인 전용 서비스", "personal-project", "personal"));
  data.tasks.push({ id: "shared-task", projectId: "service-project", space: "company", title: "연결 프로젝트의 합성 할 일", status: "decision", dueDate: "", createdAt: at }, { id: "unlinked-task", projectId: null, space: "company", title: "연결 없는 합성 할 일", status: "todo", dueDate: "", createdAt: at }, { id: "private-task", projectId: "personal-project", space: "personal", title: "개인 전용 비밀 업무", status: "todo", dueDate: "", createdAt: at });
  function record(id: string, serviceId: string, title: string, content: string): SourceRecord {
    return { id, serviceId, space: "company", projectId: serviceId === "service-b" ? "service-project" : null, externalId: id, title, content, status: "확인 필요", sourceUrl: "http://127.0.0.1:4317/api/health?source=synthetic", sourceUpdatedAt: at, collectedAt: at, deletedAt: null, taskId: null };
  }
  data.sourceRecords.push(record("record-b", "service-b", "합성 B 원본 기록", "합성 업무 원문\n<img src=x onerror=alert(1)>\n".repeat(50)), record("old-record", "service-old", "합성 마지막 정상 기록", "실패 후에도 유지할 합성 업무 내용"));
  for (let n = 0; n < 35; n++) data.notes.push({ id: `board-note-${n}`, projectId: n % 2 ? null : "service-project", space: "company", content: `기존 합성 메모 ${String(n).padStart(2,"0")}\n${n === 34 ? "오래된찾기검증 " : ""}보존할 합성 원문`, createdAt: new Date(Date.now() - n * 60000).toISOString(), updatedAt: new Date(Date.now() - n * 60000).toISOString() });
  data.notes.push({ id: "private-note", projectId: "personal-project", space: "personal", content: "개인 전용 비밀 메모", createdAt: at, updatedAt: at });
  data.activeProjects.company = "other-project";
  data = enqueueWork(data, "company", "service-project", "service-a", "합성 A 개발 요청", "change", "pr", at);
  data = enqueueWork(data, "company", "service-project", "service-b", "합성 B 개발 요청", "change", "pr", at);
  return data;
}
