import { homeRequests } from "./home-overview";
import type { Service, Task, WorkspaceData } from "./types";

export function businessStatus(service: Service, clock: number) {
  if (service.connectionStatus === "error") return { state: "error", label: "자료 수집 오류", detail: "마지막으로 가져온 기록을 표시합니다." };
  if (service.connector === "shortcut" || service.connectionStatus !== "connected" || !service.lastSuccessAt)
    return { state: "needed", label: "업무 자료 연결 필요", detail: "등록한 주소는 열 수 있습니다. 서비스의 업무 현황은 아직 확인하지 못했습니다." };
  if (clock - Date.parse(service.lastSuccessAt) > 86_400_000)
    return { state: "stale", label: "오래된 수집 자료", detail: "마지막으로 가져온 기록입니다. 최신 상태를 확인해주세요." };
  return { state: "ready", label: "업무 자료 수집됨", detail: "마지막 수집 시각 기준의 기록입니다." };
}

export function serviceWorkroom(data: WorkspaceData, selectedId: string | null, clock: number) {
  const space = data.activeSpace;
  const services = data.services.filter(service => service.space === space).slice()
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "ko-KR"));
  const service = services.find(row => row.id === selectedId) ?? null;
  const projects = data.projects.filter(project => project.space === space && (!service || service.projectId !== null && project.id === service.projectId));
  const projectIds = new Set(projects.map(project => project.id));
  const relatedProject = (projectId: string | null) => projectId !== null && projectIds.has(projectId);
  const allJobs = homeRequests(projects, clock);
  const jobs = allJobs.filter(job => !service || !job.serviceId || job.serviceId === service.id);
  const jobTaskIds = new Set(allJobs.map(job => job.id.split(":work:")[1]).filter(Boolean));
  const taskServices = new Map(projects.flatMap(project => project.automation?.turns.map(turn => [turn.id, turn.serviceId] as const) ?? []));
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(clock);
  const priority = (task: Task) => task.status === "decision" ? 0 : task.dueDate && task.dueDate < day ? 1 : task.dueDate === day ? 2 : task.status === "in_progress" ? 3 : 4;
  const tasks = data.tasks.filter(task => task.space === space && task.status !== "done" && (!service || relatedProject(task.projectId) && (!task.sourceMessageId || !taskServices.has(task.sourceMessageId) || taskServices.get(task.sourceMessageId) === service.id)) && (!task.sourceMessageId || !jobTaskIds.has(task.sourceMessageId)))
    .slice().sort((a, b) => priority(a) - priority(b) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.createdAt.localeCompare(a.createdAt));
  const requests = data.requests.filter(request => request.space === space && request.status !== "completed" && (!service || request.serviceId === service.id || request.serviceId === null && relatedProject(request.projectId)));
  const records = data.sourceRecords.filter(record => record.space === space && !record.deletedAt && (!service || record.serviceId === service.id))
    .slice().sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  return { space, services, service, projects, tasks, requests, jobs, records, day };
}
