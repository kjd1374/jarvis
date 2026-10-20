import { id, type Project, type Space, type WorkspaceData } from "../workspace/types";
import { projectUrl } from "../workspace/project-links";
import { repositoryFor } from "../automation/state";
import { enqueueWork } from "../automation/work";
import { newProjectSetup } from "../automation/provision";
import { newPlanning, planningBusy } from "./planning";

export type ProjectStage = NonNullable<Project["stage"]>;
export const stageLabels = { idea: "기획", development: "개발", live: "사용 중" };
export const projectStage = (p: Project): ProjectStage => p.stage ?? "development";
export const stageCards = [
  { stage: "idea" as const, title: "아이디어부터 정리하기", description: "아이디어를 구체화하고 AI와 기획안을 만듭니다." },
  { stage: "development" as const, title: "개발 시작·이어가기", description: "새 프로젝트를 만들거나 기존 코드를 수정하고 확인합니다." },
  { stage: "live" as const, title: "완성된 서비스 등록하기", description: "이미 사용하는 서비스를 연결해 바로 엽니다." },
];
export function createStagedProject(data: WorkspaceData, input: { space: Space; name: string; description: string; stage: ProjectStage; launchUrl?: string; automatic?: boolean }, stamp: string, projectId = id()) {
  if (!input.name.trim() || input.name.length > 160 || input.description.length > 10000 || !Object.hasOwn(stageLabels, input.stage)) throw new Error("프로젝트 내용을 확인해주세요.");
  const p: Project = { id: projectId, space: input.space, name: input.name.trim(), description: input.description.trim(), stage: input.stage, createdAt: stamp };
  if (input.stage === "idea") p.planning = newPlanning(stamp);
  if (input.stage === "live") {
    p.launchUrl = projectUrl(input.launchUrl ?? "");
    if (!p.launchUrl) throw new Error("사용할 서비스 주소를 입력해주세요.");
  }
  if (input.stage === "development" && input.automatic) p.setup = { ...newProjectSetup(stamp, "mac"), requests: p.description ? [{ id: id(), request: p.description.slice(0, 8000), mode: "change", publish: "merge", createdAt: stamp }] : [] };
  return { ...data, projects: [...data.projects, p] };
}
export function startDevelopment(data: WorkspaceData, space: Space, projectId: string, stamp: string) {
  const p = data.projects.find(p => p.space === space && p.id === projectId);
  if (!p || p.stage !== "idea" || planningBusy(p)) throw new Error("진행 중인 기획 요청을 마친 뒤 개발을 시작해주세요.");
  if (p.setup && p.setup.status !== "ready") throw new Error("기존 개발 환경 준비 상태를 먼저 확인해주세요.");
  const service = data.services.find(s => s.space === space && s.projectId === p.id && repositoryFor(s));
  const request = "프로젝트 기획안을 개발 명세로 사용해 첫 버전을 구현해주세요. 기획안의 범위와 완료 기준을 따르고, 확인되지 않은 가정은 별도로 남겨주세요.";
  let next: WorkspaceData = { ...data, projects: data.projects.map(row => row.id === p.id ? { ...row, stage: "development", ...(!service && !p.setup ? {
    setup: { ...newProjectSetup(stamp, "mac"), requests: [{ id: id(), request, mode: "change", publish: "merge", createdAt: stamp }] } } : {}) } : row) };
  if (service) next = enqueueWork(next, space, projectId, service.id, request, "change", "merge", stamp);
  return next;
}
