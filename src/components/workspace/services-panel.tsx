"use client";
import { useRef, useState } from "react";
import {
  dateLabel,
  id,
  now,
  spaceLabels,
  type Service,
} from "@/lib/workspace/types";
import { projectUrl, projectHref } from "@/lib/workspace/project-links";
import { duplicateConnection, repositoryKey } from "@/lib/workspace/project-connections";
import { normalizeWorkspace } from "@/lib/workspace/validation";
import { applySync } from "@/lib/integrations/sync";
import {
  presetAllowed,
  servicePresets,
  type ServicePreset,
} from "@/lib/integrations/catalog";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./workspace-controls";
import { GitHubMonitor } from "./github-monitor";
import { repositoryFor, requestInspection } from "@/lib/automation/state";
import { Icon } from "./icon";
import styles from "./studio.module.css";
import { useWorkspaceClock } from "./use-workspace-clock";

export function ServiceRegistrationButton({
  preset,
  children,
  service,
}: {
  service?: Service;
  preset: ServicePreset;
  children: React.ReactNode;
}) {
  const { data } = useWorkspace();
  return (
    <ScopedRegistration key={`${data.activeSpace}:${service?.id ?? "new"}`} preset={preset} service={service}>
      {children}
    </ScopedRegistration>
  );
}

function ScopedRegistration({
  preset,
  children,
  service,
}: {
  service?: Service;
  preset: ServicePreset;
  children: React.ReactNode;
}) {
  const { data, ready, saving } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!presetAllowed(preset, data.activeSpace)) return null;
  return (
    <>
      <button
        className={styles.secondaryButton}
        disabled={!ready || saving}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <ServiceEditor
          preset={preset}
          service={service}
          projectId={service ? undefined : data.activeProjects[data.activeSpace] ?? undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ServicesPanel({
  projectId,
  favoritesOnly = false,
  children,
}: {
  projectId?: string;
  favoritesOnly?: boolean;
  children?: React.ReactNode;
}) {
  const { data } = useWorkspace();
  return (
    <ServicesView
      key={`${data.activeSpace}:${projectId ?? "all"}`}
      projectId={projectId}
      favoritesOnly={favoritesOnly}
    >{children}</ServicesView>
  );
}
function ServicesView({
  projectId,
  favoritesOnly,
  children,
}: {
  projectId?: string;
  favoritesOnly: boolean;
  children?: React.ReactNode;
}) {
  const clock = useWorkspaceClock();
  const { data, ready, saving, mutate } = useWorkspace();
  const space = data.activeSpace;
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const pending = useRef(false);
  const all = data.services.filter(
    (s) => s.space === space && (!projectId || s.projectId === projectId),
  );
  const services =
    favoritesOnly && !showAll && all.some((s) => s.favorite)
      ? all.filter((s) => s.favorite)
      : all;
  async function sync(service: Service) {
    if (pending.current || saving) return;
    pending.current = true;
    try {
      const response = await fetch("/api/integrations/sync", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, space }),
      });
      const result = await response.json();
      if (!response.ok || !result.data)
        await mutate((d) =>
          applySync(
            d,
            service.id,
            space,
            { ok: false, code: "needs_connection" },
            now(),
          ),
        );
      else {
        const incoming = normalizeWorkspace(result.data);
        if (
          incoming.activeSpace !== space ||
          incoming.services.some((s) => s.space !== space)
        )
          throw new Error("Wrong scope");
        const remote = incoming.services.find(
          (s) => s.id === service.id && s.projectId === service.projectId,
        );
        if (!remote) throw new Error("Missing service");
        await mutate((d) => ({
          ...d,
          services: d.services.map((s) =>
            s.id === service.id
              ? {
                  ...s,
                  connectionStatus: remote.connectionStatus,
                  lastSuccessAt: remote.lastSuccessAt,
                  lastAttemptAt: remote.lastAttemptAt,
                  failures: remote.failures,
                  error: remote.error,
                  nextRetryAt: remote.nextRetryAt,
                }
              : s,
          ),
          sourceRecords: [
            ...d.sourceRecords.filter(
              (r) =>
                r.serviceId !== service.id ||
                !incoming.sourceRecords.some(
                  (x) =>
                    x.serviceId === service.id && x.externalId === r.externalId,
                ),
            ),
            ...incoming.sourceRecords
              .filter((r) => r.serviceId === service.id)
              .map((r) => {
                const local = d.sourceRecords.find(
                  (s) =>
                    s.serviceId === r.serviceId &&
                    s.externalId === r.externalId,
                );
                return {
                  ...r,
                  id: local?.id ?? r.id,
                  taskId: local?.taskId ?? r.taskId,
                };
              }),
          ],
          syncEvents: [
            ...d.syncEvents.filter(
              (e) => !incoming.syncEvents.some((x) => x.id === e.id),
            ),
            ...incoming.syncEvents.filter((e) => e.serviceId === service.id),
          ].slice(-200),
        }));
      }
      setError("");
    } catch {
      await mutate((d) =>
        applySync(
          d,
          service.id,
          space,
          { ok: false, code: "unavailable" },
          now(),
        ),
      ).catch(() => {});
      setError(
        "연결 상태를 확인하지 못했습니다. 마지막 정상 자료는 유지됩니다.",
      );
    } finally {
      pending.current = false;
    }
  }
  return (
    <section className={styles.detailSection} aria-label="연결 서비스">
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="link" size={17} />{" "}
          {favoritesOnly ? "자주 쓰는 서비스" : "연결 서비스"}
        </h2>
        <button disabled={!ready || saving} onClick={() => setEditing("new")}>
          서비스 등록 <Icon name="plus" size={14} />
        </button>
      </div>
      <p className={styles.detailFootnote}>
        프로젝트와 설정에서 같은 연결을 관리합니다. 주소 등록은 자동 조회·AI 연결과 별개입니다.
      </p>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {services.length ? (
        <>
          {favoritesOnly && all.some((s) => !s.favorite) && (
            <button
              className={styles.secondaryButton}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? "자주 쓰는 서비스만 보기"
                : `전체 서비스 보기 (${all.length})`}
            </button>
          )}
          <div className={styles.serviceList}>
            {services.map((service) => (
              <article key={service.id}>
                <div className={styles.detailHeading}>
                  <h3>{service.name}</h3>
                  <span
                    className={styles.detailBadge}
                    data-status={service.connectionStatus}
                  >
                    {service.connector === "shortcut"
                      ? service.monitoring?.lastSuccessAt && service.monitoring.repository === repositoryFor(service) ? "GitHub 읽기 자료 있음" : service.monitoring?.enabled ? "GitHub 점검 대기·연결 필요" : "바로가기만 등록됨"
                      : service.connectionStatus === "connected"
                        ? "마지막 읽기 수집 성공"
                        : service.connectionStatus === "error"
                          ? "연결 오류"
                          : "읽기 연결 필요"}
                  </span>
                </div>
                <p>
                  {spaceLabels[space]} ·{" "}
                  {service.projectId
                    ? data.projects.find((p) => p.id === service.projectId)
                        ?.name
                    : "영역 공통"}
                </p>
                <p className={styles.detailFootnote}>
                  연결 방식:{" "}
                  {service.connector === "shortcut"
                    ? "웹 바로가기"
                    : "v4 읽기 연동(준비 중)"}
                  <br />
                  마지막 정상 수집:{" "}
                  {service.lastSuccessAt
                    ? dateLabel(service.lastSuccessAt)
                    : "수집 기록 없음"}
                </p>
                {service.error && (
                  <p className={styles.formError}>{service.error}</p>
                )}
                {service.lastSuccessAt &&
                  clock - Date.parse(service.lastSuccessAt) > 86_400_000 && (
                    <p className={styles.formError}>
                      24시간 이상 갱신되지 않은 자료입니다.
                    </p>
                  )}
                <div className={styles.projectActions}>
                  {projectHref(service.webUrl) && (
                    <a
                      className={styles.primaryButton}
                      href={projectHref(service.webUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${service.name} 서비스 열기`}
                    >
                      서비스 열기 <Icon name="arrow" size={14} />
                    </a>
                  )}
                  {projectHref(service.repositoryUrl) && service.repositoryUrl !== service.webUrl && (
                    <a
                      className={styles.secondaryButton}
                      href={projectHref(service.repositoryUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      GitHub 기록 열기 <Icon name="arrow" size={14} />
                    </a>
                  )}
                  <button
                    className={styles.secondaryButton}
                    disabled={saving}
                    onClick={() => setEditing(service)}
                  >
                    등록 정보 수정
                  </button>
                  {service.connector !== "shortcut" && (
                    <button
                      className={styles.secondaryButton}
                      disabled={saving}
                      onClick={() => void sync(service)}
                    >
                      연결 확인·재시도
                    </button>
                  )}
                </div>
                <p className={styles.detailFootnote}>
                  작업 실행 연결 없음 · 웹 주소를 여는 기능입니다. 로컬 프로그램
                  실행은 PC 실행 연결이 필요합니다.
                </p>
                <GitHubMonitor service={service} />
                <details className={styles.revisionDetails}>
                  <summary>동기화 상세 기록</summary>
                  <p>
                    최근 시도:{" "}
                    {service.lastAttemptAt
                      ? dateLabel(service.lastAttemptAt)
                      : "없음"}
                  </p>
                  {service.nextRetryAt && (
                    <p>
                      자동 재시도 연결 시 기준: {dateLabel(service.nextRetryAt)}
                    </p>
                  )}
                  {data.syncEvents
                    .filter(
                      (e) => e.serviceId === service.id && e.space === space,
                    )
                    .slice(-10)
                    .reverse()
                    .map((event) => (
                      <p key={event.id}>
                        {dateLabel(event.attemptedAt)} ·{" "}
                        {event.status === "success"
                          ? "수집 성공"
                          : "수집 실패/연결 필요"}{" "}
                        · {event.received}건
                      </p>
                    ))}
                </details>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.detailEmpty}>
          <p>
            아직 등록한 서비스가 없습니다. 주소를 등록하면 프로젝트와 연결해 열
            수 있습니다.
          </p>
        </div>
      )}
      {children}
      {editing && (
        <ServiceEditor
          service={editing === "new" ? undefined : editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function ServiceEditor({
  service,
  projectId,
  preset = "custom",
  onClose,
}: {
  service?: Service;
  projectId?: string;
  preset?: ServicePreset;
  onClose: () => void;
}) {
  const { data, saving, mutate } = useWorkspace();
  const space = data.activeSpace;
  const initialPreset = service
    ? repositoryKey(service.webUrl) && (!service.repositoryUrl || service.repositoryUrl === service.webUrl) ? "github" : "custom"
    : presetAllowed(preset, space) ? preset : "custom";
  const [template, setTemplate] = useState(initialPreset);
  const [name, setName] = useState(
    service?.name ?? servicePresets[initialPreset].name,
  );
  const [webUrl, setWebUrl] = useState(
    service?.webUrl ?? servicePresets[initialPreset].webUrl,
  );
  const [repositoryUrl, setRepositoryUrl] = useState(
    service?.repositoryUrl ?? servicePresets[initialPreset].repositoryUrl,
  );
  const [selected, setSelected] = useState(
    service?.projectId ?? projectId ?? "",
  );
  const [connector, setConnector] = useState<Service["connector"]>(
    service?.connector ?? servicePresets[initialPreset].connector,
  );
  const [favorite, setFavorite] = useState(service?.favorite ?? true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const locked =
    !!service &&
    (data.sourceRecords.some((r) => r.serviceId === service.id) ||
      data.requests.some((r) => r.serviceId === service.id));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || pending.current || !name.trim()) return;
    pending.current = true;
    try {
      const urls = {
        webUrl: projectUrl(webUrl, template === "github"),
        repositoryUrl: projectUrl(template === "github" ? webUrl : repositoryUrl, true),
      };
      if (!urls.webUrl) throw new Error("서비스 웹 주소를 입력해주세요.");
      const changed =
        service?.connector !== connector || service.webUrl !== urls.webUrl || service.repositoryUrl !== urls.repositoryUrl;
      let record: Service = {
        ...(service?.monitoring ? { monitoring: service.monitoring } : {}),
        id: service?.id ?? id(),
        space,
        projectId: selected || null,
        name: name.trim(),
        ...urls,
        connector,
        favorite,
        createdAt: service?.createdAt ?? now(),
        lastSuccessAt: service?.lastSuccessAt ?? null,
        lastAttemptAt: service?.lastAttemptAt ?? null,
        connectionStatus:
          !changed && service
            ? service.connectionStatus
            : connector === "shortcut"
              ? "shortcut"
              : "needs_connection",
        error: changed ? null : (service?.error ?? null),
        failures: changed ? 0 : (service?.failures ?? 0),
        nextRetryAt: changed ? null : (service?.nextRetryAt ?? null),
      };
      if (repositoryFor(record)) {
        if (!service?.monitoring || repositoryFor(record) !== service.monitoring.repository) record = requestInspection(record, now());
      }
      else if (record.monitoring) record = { ...record, monitoring: { ...record.monitoring, enabled: false, job: null } };
      await mutate((d) => {
        if (
          d.services.some(
            (s) =>
              s.id !== record.id &&
              duplicateConnection(s, record),
          )
        )
          throw new Error(
            "이 영역·프로젝트에 이미 등록된 주소입니다. 기존 등록 정보를 수정해주세요.",
          );
        return {
          ...d,
          services: [...d.services.filter((s) => s.id !== record.id), record],
        };
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      pending.current = false;
    }
  }
  return (
    <Modal
      title={service ? "서비스 수정" : "서비스 등록"}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className={styles.modalBody} onSubmit={save}>
        <p className={styles.modalDescription}>
          {spaceLabels[space]} 영역에 등록합니다. 비밀키·토큰은 입력하지
          않습니다.
        </p>
        {!service && (
          <>
            <label className={styles.field}>
              등록할 서비스
              <select
                aria-label="서비스 등록 양식"
                value={template}
                onChange={(event) => {
                  const next = event.target.value as ServicePreset;
                  if (!presetAllowed(next, space)) return;
                  setTemplate(next);
                  setName(servicePresets[next].name);
                  setWebUrl(servicePresets[next].webUrl);
                  setRepositoryUrl(servicePresets[next].repositoryUrl);
                  setConnector(servicePresets[next].connector);
                }}
              >
                {Object.entries(servicePresets)
                  .filter(([key]) => presetAllowed(key as ServicePreset, space))
                  .map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
              </select>
            </label>
            <p className={styles.modalDescription}>
              {servicePresets[template].hint}
            </p>
          </>
        )}
        <label className={styles.field}>
          서비스 이름
          <input
            aria-label="서비스 이름"
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          소속 프로젝트
          <select
            aria-label="서비스 프로젝트"
            value={selected}
            disabled={locked || !!projectId || saving}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">영역 공통</option>
            {data.projects
              .filter((p) => p.space === space)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className={styles.field}>
          {template === "github" ? "GitHub 저장소 주소" : "웹 주소"}
          <input
            aria-label="서비스 웹 주소"
            type="url"
            required
            maxLength={2048}
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
            placeholder="https://서비스-주소"
          />
        </label>
        {template !== "github" && <label className={styles.field}>
          GitHub 저장소(선택)
          <input
            aria-label="서비스 저장소 주소"
            type="url"
            maxLength={2048}
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            placeholder="https://github.com/소유자/저장소"
          />
        </label>}
        <label className={styles.field}>
          연결 방식
          <select
            aria-label="서비스 연결 방식"
            value={connector}
            onChange={(e) =>
              setConnector(e.target.value as Service["connector"])
            }
          >
            <option value="shortcut">바로가기만 등록</option>
            {space === "company" && (
              <option value="v4">v4 읽기 연결 준비</option>
            )}
          </select>
        </label>
        <label className={styles.confirmation}>
          <input
            type="checkbox"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />{" "}
          자주 사용하는 서비스
        </label>
        <p className={styles.detailFootnote}>
          읽기·실행 연결은 주소 등록만으로 활성화되지 않습니다. 서버의 연결
          코드와 인증이 별도로 필요합니다.
        </p>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            취소
          </button>
          <button
            className={styles.primaryButton}
            disabled={saving || !name.trim()}
          >
            서비스 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
