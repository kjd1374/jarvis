"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  assertLinks,
  id,
  now,
  spaceLabels,
  statusLabels,
  today,
  type TaskStatus,
} from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { Modal, WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import { RequestsPanel } from "./requests-panel";
import { newProjectSetup } from "@/lib/automation/provision";
import styles from "./studio.module.css";

export function WorkItems({
  kind,
  initialView = "tasks",
}: {
  kind: "projects" | "tasks";
  initialView?: "tasks" | "requests";
}) {
  const { data } = useWorkspace();
  return (
    <WorkItemsView
      key={`${kind}:${initialView}:${data.activeSpace}:${data.activeProjects[data.activeSpace]}`}
      kind={kind}
      initialView={initialView}
    />
  );
}

function WorkItemsView({
  kind,
  initialView,
}: {
  kind: "projects" | "tasks";
  initialView: "tasks" | "requests";
}) {
  const router = useRouter();
  const { data, ready, saving, error: storageError, mutate } = useWorkspace();
  const space = data.activeSpace;
  const projects = data.projects.filter((p) => p.space === space);
  const projectId = data.activeProjects[space];
  const tasks = data.tasks.filter(
    (t) => t.space === space && (!projectId || t.projectId === projectId),
  );
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(initialView);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [selectedProject, setSelectedProject] = useState(projectId ?? "");
  const [dueDate, setDueDate] = useState(today());
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const creatingNow = useRef(false);
  const label = kind === "projects" ? "프로젝트" : "업무";

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving || creatingNow.current) return;
    creatingNow.current = true;
    try {
      await mutate((d) => {
        if (kind === "projects")
          return {
            ...d,
            projects: [
              ...d.projects,
              {
                id: id(),
                space,
                name: title.trim(),
                description: description.trim(),
                ...(automatic ? { setup: { ...newProjectSetup(now()), requests: description.trim() ? [{ id: id(), request: description.trim().slice(0, 8000), mode: "change" as const, publish: "merge" as const, createdAt: now() }] : [] } } : {}),
                createdAt: now(),
              },
            ],
          };
        assertLinks(d, space, selectedProject || null);
        return {
          ...d,
          tasks: [
            ...d.tasks,
            {
              id: id(),
              space,
              projectId: selectedProject || null,
              title: title.trim(),
              status,
              dueDate,
              createdAt: now(),
            },
          ],
        };
      });
      setCreating(false);
      setTitle("");
      setDescription("");
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      creatingNow.current = false;
    }
  }

  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>
            {kind === "projects" ? "PROJECTS" : "WORK & DECISIONS"}
          </p>
          <h1>{label}</h1>
          <p>
            {kind === "projects"
              ? "대화와 업무, 자료를 같은 프로젝트의 맥락으로 묶어주세요."
              : "오늘 할 일과 진행 중인 일, 내 결정이 필요한 일을 관리하세요."}
          </p>
        </div>
        <button
          className={styles.primaryButton}
          disabled={!ready}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={17} />
          {label} 만들기
        </button>
      </div>
      {kind === "tasks" && (
        <div className={styles.filterTabs} aria-label="업무 보기">
          <Link href="/tasks">시트 작업 공간</Link>
          <button
            aria-pressed={view === "tasks"}
            onClick={() => setView("tasks")}
          >
            할 일
          </button>
          <button
            aria-pressed={view === "requests"}
            onClick={() => setView("requests")}
          >
            수정 요청
          </button>
        </div>
      )}
      {!ready ? (
        <section className={styles.emptyState} aria-busy={!storageError}>
          <h2>
            {storageError
              ? `${label}를 불러오지 못했습니다`
              : `${label}를 불러오는 중입니다`}
          </h2>
          <p>
            {storageError
              ? "빈 목록으로 처리하거나 기존 기록을 덮어쓰지 않았습니다. 다시 불러오거나 설정에서 저장 상태를 확인하세요."
              : "저장된 기록을 확인하고 있습니다. 잠시만 기다려주세요."}
          </p>
          {storageError && (
            <Link
              className={styles.secondaryButton}
              href="/settings#storage-recovery"
            >
              저장 상태 확인
            </Link>
          )}
        </section>
      ) : kind === "tasks" && view === "requests" ? (
        <RequestsPanel projectId={projectId ?? undefined} />
      ) : (
        <>
          {kind === "tasks" && (
            <div className={styles.filterTabs} aria-label="업무 상태 필터">
              {[["", "전체"], ...Object.entries(statusLabels)].map(
                ([value, text]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {text}
                    <span>
                      {tasks.filter((t) => !value || t.status === value).length}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
          {kind === "projects" ? (
            <div className={styles.projectGrid}>
              {projects.length ? (
                projects.map((project) => (
                  <Link
                    href={`/projects/${project.id}`}
                    className={styles.projectCard}
                    key={project.id}
                    aria-label={`${project.name} 프로젝트 열기`}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      if (!ready || saving) return;
                      void mutate((d) => ({
                        ...d,
                        activeProjects: {
                          ...d.activeProjects,
                          [space]: project.id,
                        },
                      }))
                        .then(() => router.push(`/projects/${project.id}`))
                        .catch(() => {});
                    }}
                  >
                    <span className={styles.projectCardIcon}>
                      <Icon name="folder" size={25} />
                    </span>
                    <span className={styles.itemScope}>
                      {spaceLabels[space]}
                    </span>
                    <h2>{project.name}</h2>
                    <p>
                      {project.description ||
                        "프로젝트의 업무와 관련 자료를 모아보세요."}
                    </p>
                    <div className={styles.projectCounts}>
                      <span>
                        {
                          data.tasks.filter((t) => t.projectId === project.id)
                            .length
                        }
                        개 업무
                      </span>
                      <span>
                        {
                          data.documents.filter(
                            (f) => f.projectId === project.id,
                          ).length
                        }
                        개 자료
                      </span>
                      <span>
                        {
                          data.conversations.filter(
                            (c) => c.projectId === project.id,
                          ).length
                        }
                        개 대화
                      </span>
                    </div>
                    <span className={styles.projectOpen}>
                      프로젝트 열기 <Icon name="arrow" size={16} />
                    </span>
                  </Link>
                ))
              ) : (
                <EmptyState
                  icon="folder"
                  title="업무에 하나의 흐름을 만들어주세요"
                  description="프로젝트를 만들면 대화, 업무와 파일을 같은 맥락으로 연결할 수 있습니다."
                  onCreate={() => setCreating(true)}
                  disabled={!ready}
                  label="첫 프로젝트 만들기"
                />
              )}
            </div>
          ) : (
            <div className={styles.taskList}>
              {tasks.filter((t) => !filter || t.status === filter).length ? (
                tasks
                  .filter((t) => !filter || t.status === filter)
                  .map((task) => (
                    <article className={styles.taskRow} key={task.id}>
                      <button
                        className={`${styles.checkTask} ${task.status === "done" ? styles.checkedTask : ""}`}
                        aria-label={
                          task.status === "done"
                            ? "업무 다시 열기"
                            : "업무 완료"
                        }
                        disabled={saving}
                        onClick={() =>
                          void mutate((d) => ({
                            ...d,
                            tasks: d.tasks.map((t) =>
                              t.id === task.id
                                ? {
                                    ...t,
                                    status:
                                      t.status === "done" ? "todo" : "done",
                                  }
                                : t,
                            ),
                          })).catch(() => {})
                        }
                      >
                        {task.status === "done" && (
                          <Icon name="check" size={17} />
                        )}
                      </button>
                      <div className={styles.taskBody}>
                        <h2>{task.title}</h2>
                        <p>
                          {task.projectId
                            ? projects.find((p) => p.id === task.projectId)
                                ?.name
                            : `${spaceLabels[space]} 공통 업무`}
                          {task.dueDate && <span> · {task.dueDate}</span>}
                        </p>
                      </div>
                      <label>
                        <span className={styles.srOnly}>업무 상태</span>
                        <select
                          aria-label={`${task.title} 상태`}
                          disabled={saving}
                          value={task.status}
                          onChange={(event) => {
                            const status = event.target.value as TaskStatus;
                            void mutate((d) => ({
                              ...d,
                              tasks: d.tasks.map((t) =>
                                t.id === task.id ? { ...t, status } : t,
                              ),
                            })).catch(() => {});
                          }}
                        >
                          {Object.entries(statusLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    </article>
                  ))
              ) : (
                <EmptyState
                  icon="check"
                  title="다음 할 일을 적어주세요"
                  description="저장한 업무는 업무실의 오늘 할 일과 진행 상황에 반영됩니다."
                  onCreate={() => setCreating(true)}
                  disabled={!ready}
                  label="첫 업무 만들기"
                />
              )}
            </div>
          )}
        </>
      )}
      {creating && (
        <Modal title={`${label} 만들기`} onClose={() => setCreating(false)}>
          <form className={styles.modalBody} onSubmit={create}>
            <p className={styles.modalDescription}>
              {spaceLabels[space]} 영역에 저장합니다.
            </p>
            <label className={styles.field}>
              {label} 이름
              <input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  kind === "projects" ? "프로젝트 이름" : "해야 할 일"
                }
              />
            </label>
            {kind === "projects" ? (
              <><label className={styles.field}>
                프로젝트 설명
                <textarea
                  rows={3}
                  maxLength={10000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="만들고 싶은 기능과 목표를 적어주세요. 자동 준비 시 첫 개발 요청으로 실행합니다."
                />
              </label>
              <label className={styles.field}><span><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} /> 저장소·실행 환경 자동 준비</span></label>
              <p className={styles.modalDescription}>비공개 GitHub 저장소를 만들고 사용 가능한 환경을 선택합니다. 설명이 있으면 첫 개발 요청으로 실행하고, 검증 후 병합합니다. 유료 서비스로 자동 전환하지 않습니다. 기존 저장소를 직접 연결하려면 해제하세요.</p></>
            ) : (
              <>
                <label className={styles.field}>
                  연결 프로젝트
                  <select
                    value={selectedProject}
                    onChange={(event) => setSelectedProject(event.target.value)}
                  >
                    <option value="">영역 공통 업무</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.formColumns}>
                  <label className={styles.field}>
                    진행 상태
                    <select
                      aria-label="진행 상태"
                      value={status}
                      onChange={(event) =>
                        setStatus(event.target.value as TaskStatus)
                      }
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    일정
                    <input
                      aria-label="일정"
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
            {error && (
              <p className={styles.formError} role="alert">
                {error}
              </p>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setCreating(false)}
              >
                취소
              </button>
              <button
                className={styles.primaryButton}
                disabled={saving || !title.trim()}
              >
                {label} 저장
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  onCreate,
  disabled,
  label,
}: {
  icon: "folder" | "check" | "note";
  title: string;
  description: string;
  onCreate: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className={styles.emptyState}>
      <span>
        <Icon name={icon} size={34} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <button
        className={styles.secondaryButton}
        onClick={onCreate}
        disabled={disabled}
      >
        <Icon name="plus" size={16} />
        {label}
      </button>
    </div>
  );
}
