import { projectUrl } from "./project-links";
import type { Project, Service, WorkspaceData } from "./types";

export function repositoryKey(value: string): string | null {
  try {
    const url = new URL(projectUrl(value, true));
    const [owner, repository] = url.pathname.split("/").filter(Boolean);
    return `${owner}/${repository.replace(/\.git$/i, "")}`.toLowerCase();
  } catch {
    return null;
  }
}
export function githubConnectionUrl(service: Service): string | null {
  return [service.repositoryUrl, service.webUrl].find((url) =>
    repositoryKey(url),
  ) ?? null;
}
function sameWeb(a: string, b: string) {
  try {
    return projectUrl(a) === projectUrl(b);
  } catch {
    return false;
  }
}
function hasRepository(service: Service, key: string) {
  return [service.repositoryUrl, service.webUrl].some(
    (url) => repositoryKey(url) === key,
  );
}
export function duplicateConnection(a: Service, b: Service) {
  if (a.space !== b.space || a.projectId !== b.projectId) return false;
  if (sameWeb(a.webUrl, b.webUrl)) return true;
  // Reuse a repository-only registration when it is already part of a web
  // service. Distinct web deployments may legitimately share a repository.
  const aRepository = repositoryKey(a.webUrl);
  const bRepository = repositoryKey(b.webUrl);
  return !!(
    (aRepository && hasRepository(b, aRepository)) ||
    (bRepository && hasRepository(a, bRepository))
  );
}
function legacyId(project: Project, kind: string, occupied: Set<string>) {
  // Stable across browsers and repeated reads; collisions never overwrite IDs.
  let hash = BigInt("14695981039346656037");
  const bytes = new TextEncoder().encode(
    JSON.stringify([project.space, project.id, kind]),
  );
  for (const byte of bytes)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(byte)) * BigInt("1099511628211"),
    );
  const base = `legacy-${kind}-${hash.toString(16)}`;
  let result = base;
  for (let suffix = 1; occupied.has(result); suffix++)
    result = `${base}-${suffix}`;
  occupied.add(result);
  return result;
}

// Lossless v1 compatibility projection. Reading does not write to IndexedDB or
// the server. The next ordinary atomic save persists the unified records. Old
// project URL fields remain an archive and are never edited or resurrected.
export function unifyProjectConnections(data: WorkspaceData): WorkspaceData {
  let services = data.services;
  const occupied = new Set(services.map((service) => service.id));
  const projects = data.projects.map((project) => {
    if (
      project.connectionsUnified ||
      (!project.repositoryUrl && !project.serviceUrl)
    )
      return project;
    for (const kind of ["service", "repository"] as const) {
      const raw = kind === "repository"
        ? project.repositoryUrl : project.serviceUrl;
      if (!raw) continue;
      let url: string;
      try {
        url = projectUrl(raw, kind === "repository");
      } catch {
        continue;
      }
      const key = kind === "repository" ? repositoryKey(url) : null;
      if (
        services.some((service) =>
          service.space === project.space &&
          service.projectId === project.id &&
          (key ? hasRepository(service, key) : sameWeb(service.webUrl, url)),
        )
      )
        continue;
      if (services.length >= 100_000)
        throw new Error("연결 목록이 너무 많습니다. 기존 주소는 유지됩니다.");
      services = [...services, {
        id: legacyId(project, kind, occupied),
        space: project.space,
        projectId: project.id,
        name: `${project.name.slice(0, 100)} · ${kind === "repository" ? "GitHub" : "웹 서비스"}`,
        webUrl: url,
        repositoryUrl: kind === "repository" ? url : "",
        connector: "shortcut",
        favorite: true,
        createdAt: project.createdAt,
        lastSuccessAt: null,
        lastAttemptAt: null,
        connectionStatus: "shortcut",
        error: null,
        failures: 0,
        nextRetryAt: null,
      }];
    }
    return { ...project, connectionsUnified: true as const };
  });
  return projects.some((project, index) => project !== data.projects[index])
    ? { ...data, projects, services } : data;
}
