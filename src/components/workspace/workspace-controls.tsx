"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { useWorkspace } from "./workspace-provider";
import { spaceLabels, updateContext, type Space } from "@/lib/workspace/types";
import styles from "./studio.module.css";

export function WorkspaceControls({
  selectedProjectId,
  onScopeChange,
}: {
  selectedProjectId?: string;
  onScopeChange?: (projectId: string | null, space: Space) => void;
} = {}) {
  const { data, ready, saving, error, mutate, retryLoad } = useWorkspace();
  const space = data.activeSpace;
  return (
    <div className={styles.workspaceControls}>
      <div className={styles.scopeControls}>
        <div className={styles.spaceSwitch} aria-label="업무 영역">
          {(["company", "personal"] as Space[]).map((value) => (
            <button
              key={value}
              disabled={!ready || saving}
              aria-pressed={space === value}
              onClick={() =>
                void mutate((d) => ({ ...d, activeSpace: value }))
                  .then(() =>
                    onScopeChange?.(data.activeProjects[value], value),
                  )
                  .catch(() => {})
              }
            >
              {spaceLabels[value]}
            </button>
          ))}
        </div>
        <span className={styles.scopeDivider} />
        <label className={styles.projectSelect}>
          <Icon name="folder" size={15} />
          <select
            aria-label="프로젝트 범위"
            disabled={!ready || saving}
            value={selectedProjectId ?? data.activeProjects[space] ?? ""}
            onChange={(event) => {
              const projectId = event.target.value || null;
              void mutate((d) => ({
                ...d,
                activeProjects: {
                  ...d.activeProjects,
                  [space]: projectId,
                },
              }))
                .then(() => onScopeChange?.(projectId, space))
                .catch(() => {});
            }}
          >
            <option value="">모든 프로젝트</option>
            {data.projects
              .filter((p) => p.space === space)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <span
        className={error ? styles.storageError : styles.saveStatus}
        role="status"
      >
        <span />
        {error
          ? "저장 오류"
          : !ready
            ? "불러오는 중"
            : saving
              ? "저장 중…"
              : "이 브라우저에 저장"}
      </span>
      {error && (
        <div className={styles.errorBanner} role="alert">
          <p>{error}</p>
          <button
            className={styles.retryButton}
            disabled={saving}
            onClick={retryLoad}
          >
            다시 불러오기
          </button>
        </div>
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.modalHeader}>
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="닫기">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ContextEditor({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const { data, mutate, saving } = useWorkspace();
  const space = data.activeSpace;
  const note = data.contexts.find(
    (n) => n.space === space && n.projectId === projectId,
  );
  const [content, setContent] = useState(note?.content ?? "");
  const [error, setError] = useState("");
  const name = projectId
    ? data.projects.find((p) => p.id === projectId)?.name
    : `${spaceLabels[space]} 전체`;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await mutate((d) => updateContext(d, space, projectId, content.trim()));
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  }
  return (
    <Modal title="업무 맥락 편집" onClose={onClose}>
      <form className={styles.modalBody} onSubmit={save}>
        <p className={styles.modalDescription}>
          {name}에 계속 기억할 목표, 배경, 결정 사항과 기준을 적어주세요. 이전
          내용은 수정 이력에 보관됩니다.
        </p>
        <label className={styles.field}>
          누적 맥락
          <textarea
            aria-label="누적 맥락"
            autoFocus
            rows={9}
            value={content}
            maxLength={100000}
            onChange={(event) => setContent(event.target.value)}
            placeholder="어떤 일을 하고 있나요? 기억해야 할 배경과 기준은 무엇인가요?"
          />
        </label>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
          >
            취소
          </button>
          <button className={styles.primaryButton} disabled={saving}>
            맥락 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
