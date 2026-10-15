"use client";
import { useRef, useState } from "react";
import {
  dateLabel,
  id,
  now,
  requestLabels,
  spaceLabels,
  type ChangeRequest,
  type RequestStatus,
} from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { Modal } from "./workspace-controls";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function RequestsPanel({ projectId }: { projectId?: string }) {
  const { data } = useWorkspace();
  return (
    <RequestsView
      key={`${data.activeSpace}:${projectId ?? "all"}`}
      projectId={projectId}
    />
  );
}
function RequestsView({ projectId }: { projectId?: string }) {
  const { data, ready, saving } = useWorkspace();
  const space = data.activeSpace;
  const [editing, setEditing] = useState<ChangeRequest | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const requests = data.requests
    .filter(
      (r) => r.space === space && (!projectId || r.projectId === projectId),
    )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  async function copy(request: ChangeRequest) {
    try {
      await navigator.clipboard.writeText(
        `${request.title}\n\n${request.content}`,
      );
      setNotice(
        "요청을 복사했습니다. 실제 서비스에는 아직 전송하지 않았습니다.",
      );
    } catch {
      setNotice(
        "자동 복사를 사용할 수 없습니다. 아래 요청 내용을 선택해 복사해주세요.",
      );
    }
  }
  return (
    <section className={styles.detailSection} aria-label="수정 요청 관리">
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="check" size={17} /> 수정 요청 · 검증
        </h2>
        <button disabled={!ready || saving} onClick={() => setEditing("new")}>
          수정 요청 등록 <Icon name="plus" size={14} />
        </button>
      </div>
      <p className={styles.detailFootnote}>
        요청을 저장해도 서비스가 수정되지는 않습니다. 현재는 요청을 복사해
        서비스에서 작업하고, 처리 상태와 검증 결과를 직접 기록합니다.
      </p>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {requests.length ? (
        <div className={styles.requestList}>
          {requests.map((request) => {
            const service = data.services.find(
              (s) => s.id === request.serviceId && s.space === space,
            );
            return (
              <article key={request.id}>
                <div className={styles.detailHeading}>
                  <h3>{request.title}</h3>
                  <span
                    className={styles.detailBadge}
                    data-status={request.status}
                  >
                    {requestLabels[request.status]}
                  </span>
                </div>
                <p>{request.content}</p>
                <small>
                  {spaceLabels[space]} ·{" "}
                  {request.projectId
                    ? data.projects.find((p) => p.id === request.projectId)
                        ?.name
                    : "영역 공통"}{" "}
                  · {service?.name ?? "서비스 미지정"}
                </small>
                <p className={styles.detailFootnote}>
                  {request.status === "completed"
                    ? "사용자가 서비스에서 결과를 확인하고 완료로 기록했습니다."
                    : "자동 실행 연결 없음 · 실제 변경은 대상 서비스에서 진행하세요."}
                </p>
                {request.verification && (
                  <p className={styles.verification}>
                    사용자 검증 기록: {request.verification}
                    {request.verifiedAt &&
                      ` · ${dateLabel(request.verifiedAt)}`}
                  </p>
                )}
                <div className={styles.projectActions}>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => void copy(request)}
                  >
                    요청 복사
                  </button>
                  {service && projectHref(service.webUrl) && (
                    <a
                      className={styles.secondaryButton}
                      href={projectHref(service.webUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      대상 서비스 열기
                    </a>
                  )}
                  <button
                    className={styles.secondaryButton}
                    disabled={saving}
                    onClick={() => setEditing(request)}
                  >
                    처리 상태 기록
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.detailEmpty}>
          <p>
            아직 수정 요청이 없습니다. 바꿀 대상과 원하는 결과를 남겨주세요.
          </p>
        </div>
      )}
      {editing && (
        <RequestEditor
          request={editing === "new" ? undefined : editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function RequestEditor({
  request,
  projectId,
  onClose,
}: {
  request?: ChangeRequest;
  projectId?: string;
  onClose: () => void;
}) {
  const { data, saving, mutate } = useWorkspace();
  const space = data.activeSpace;
  const [title, setTitle] = useState(request?.title ?? "");
  const [content, setContent] = useState(request?.content ?? "");
  const [selected, setSelected] = useState(
    request?.projectId ?? projectId ?? data.activeProjects[space] ?? "",
  );
  const [serviceId, setServiceId] = useState(request?.serviceId ?? "");
  const [status, setStatus] = useState<RequestStatus>(
    request?.status ?? "registered",
  );
  const [verification, setVerification] = useState(request?.verification ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || pending.current || !title.trim() || !content.trim()) return;
    pending.current = true;
    try {
      if (status === "completed" && (!confirmed || !verification.trim()))
        throw new Error(
          "서비스에서 결과를 확인하고 검증 내용과 확인 동의를 남겨야 완료할 수 있습니다.",
        );
      const stamp = now();
      const record: ChangeRequest = {
        id: request?.id ?? id(),
        space,
        projectId: selected || null,
        serviceId: serviceId || null,
        title: title.trim(),
        content: content.trim(),
        status,
        approval:
          status === "completed"
            ? "approved"
            : status === "awaiting_review"
              ? "pending"
              : "not_requested",
        verification: verification.trim(),
        verifiedAt: status === "completed" ? stamp : null,
        createdAt: request?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      await mutate((d) => ({
        ...d,
        requests: [...d.requests.filter((r) => r.id !== record.id), record],
      }));
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "저장하지 못했습니다. 입력 내용은 유지됩니다.",
      );
    } finally {
      pending.current = false;
    }
  }
  return (
    <Modal
      title={request ? "요청 처리 상태 기록" : "수정 요청 등록"}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className={styles.modalBody} onSubmit={save}>
        <p className={styles.modalDescription}>
          {spaceLabels[space]} 영역 · 등록과 상태 기록만 수행합니다. 외부 서비스
          변경이나 실행을 승인·시작하는 기능은 연결되지 않았습니다.
        </p>
        <label className={styles.field}>
          요청 제목
          <input
            aria-label="요청 제목"
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          변경할 내용
          <textarea
            aria-label="요청 내용"
            required
            rows={4}
            maxLength={20000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="어느 서비스의 무엇을 어떻게 바꿀지 적어주세요."
          />
        </label>
        <label className={styles.field}>
          프로젝트
          <select
            aria-label="요청 프로젝트"
            value={selected}
            disabled={!!projectId || !!request}
            onChange={(e) => {
              setSelected(e.target.value);
              setServiceId("");
            }}
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
          대상 서비스
          <select
            aria-label="요청 서비스"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">미지정</option>
            {data.services
              .filter(
                (s) => s.space === space && s.projectId === (selected || null),
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        {request && (
          <>
            <label className={styles.field}>
              직접 확인한 처리 상태
              <select
                aria-label="요청 처리 상태"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as RequestStatus);
                  setConfirmed(false);
                }}
              >
                {Object.entries(requestLabels).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              검증 내용
              <textarea
                aria-label="요청 검증 내용"
                rows={3}
                maxLength={10000}
                value={verification}
                onChange={(e) => setVerification(e.target.value)}
                placeholder="대상과 변경 내용, 확인한 결과를 기록하세요."
              />
            </label>
            {status === "completed" && (
              <label className={styles.confirmation}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                대상 서비스에서 변경 결과를 직접 확인했습니다.
              </label>
            )}
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
            disabled={saving}
            onClick={onClose}
          >
            취소
          </button>
          <button
            className={styles.primaryButton}
            disabled={saving || !title.trim() || !content.trim()}
          >
            요청 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
