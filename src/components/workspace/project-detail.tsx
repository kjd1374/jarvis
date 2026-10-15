"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  assertLinks,
  dateLabel,
  fileSize,
  spaceLabels,
  statusLabels,
  type Project,
} from "@/lib/workspace/types";
import { projectHref, projectUrl } from "@/lib/workspace/project-links";
import { ContextEditor, Modal, WorkspaceControls } from "./workspace-controls";
import { useWorkspace } from "./workspace-provider";
import { Icon } from "./icon";
import { NotesPanel } from "./notes-panel";
import { ServicesPanel } from "./services-panel";
import { RequestsPanel } from "./requests-panel";
import { SourceResults, SourcesPanel } from "./sources-panel";
import styles from "./studio.module.css";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data, ready, error } = useWorkspace();
  const project = data.projects.find(
    (p) => p.id === projectId && p.space === data.activeSpace,
  );
  if (!ready)
    return (
      <div className={styles.studio}>
        <WorkspaceControls />
        <div className={styles.loadState} role="status">
          <h1>프로젝트</h1>
          <p>
            {error
              ? "기록을 다시 불러오면 프로젝트를 확인할 수 있습니다."
              : "프로젝트를 불러오는 중입니다."}
          </p>
        </div>
      </div>
    );
  if (!project)
    return (
      <div className={styles.studio}>
        <WorkspaceControls />
        <section className={styles.emptyState}>
          <span>
            <Icon name="folder" size={30} />
          </span>
          <h1>이 영역에서 프로젝트를 찾을 수 없습니다</h1>
          <p>
            회사·개인 영역을 확인해주세요. 이 프로젝트를 저장한 브라우저와
            주소에서 열어야 합니다.
          </p>
          <Link className={styles.primaryButton} href="/projects">
            프로젝트 목록
          </Link>
        </section>
      </div>
    );
  return (
    <ProjectView key={`${project.id}:${project.space}`} project={project} />
  );
}

function ProjectView({ project }: { project: Project }) {
  const { data, saving, mutate } = useWorkspace();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const navigating = useRef(false);
  const tasks = data.tasks.filter(
    (t) => t.space === project.space && t.projectId === project.id,
  );
  const documents = data.documents.filter(
    (f) => f.space === project.space && f.projectId === project.id,
  );
  const conversations = data.conversations
    .filter((c) => c.space === project.space && c.projectId === project.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const note = data.contexts.find(
    (c) => c.space === project.space && c.projectId === project.id,
  );
  const revisions = data.contextRevisions
    .filter((r) => r.contextId === note?.id)
    .slice()
    .reverse();
  const done = tasks.filter((t) => t.status === "done").length;
  const decisions = tasks.filter((t) => t.status === "decision");
  const pending = [
    ...decisions,
    ...tasks.filter((t) => t.status === "in_progress"),
    ...tasks.filter((t) => t.status === "todo"),
  ];
  const repositoryUrl = projectHref(project.repositoryUrl);
  const serviceUrl = projectHref(project.serviceUrl);

  async function openWorkspace(path: string, conversationId?: string) {
    if (saving || navigating.current) return;
    navigating.current = true;
    try {
      await mutate((d) => {
        assertLinks(d, project.space, project.id);
        if (
          conversationId &&
          !d.conversations.some(
            (c) =>
              c.id === conversationId &&
              c.projectId === project.id &&
              c.space === project.space,
          )
        )
          throw new Error("이 프로젝트의 대화를 찾을 수 없습니다.");
        return {
          ...d,
          activeProjects: { ...d.activeProjects, [project.space]: project.id },
          activeConversations: conversationId
            ? { ...d.activeConversations, [project.space]: conversationId }
            : d.activeConversations,
        };
      });
      router.push(path);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "열지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      navigating.current = false;
    }
  }

  return (
    <div className={styles.studio}>
      <WorkspaceControls
        selectedProjectId={project.id}
        onScopeChange={(id) =>
          router.push(id ? `/projects/${id}` : "/projects")
        }
      />
      <Link className={styles.projectBack} href="/projects">
        <Icon name="arrow" size={15} /> 프로젝트 목록
      </Link>
      <header className={styles.projectDetailHeader}>
        <div className={styles.projectIdentity}>
          <span className={styles.projectDetailIcon}>
            <Icon name="folder" size={28} />
          </span>
          <div>
            <p className={styles.eyebrow}>
              {spaceLabels[project.space]} 프로젝트
            </p>
            <h1>{project.name}</h1>
            <p>목표와 기록을 모으고, 다음 할 일을 이어가세요.</p>
          </div>
        </div>
        <div className={styles.projectActions}>
          <button
            className={styles.secondaryButton}
            disabled={saving}
            onClick={() => setEditing(true)}
          >
            <Icon name="settings" size={15} /> 프로젝트 수정
          </button>
          <button
            className={styles.primaryButton}
            disabled={saving}
            onClick={() => void openWorkspace("/assistant")}
          >
            <Icon name="message" size={16} /> 이 프로젝트에서 대화
          </button>
        </div>
      </header>
      {notice && (
        <p className={styles.errorBanner} role="alert">
          {notice}
        </p>
      )}
      <div className={styles.projectDetailGrid}>
        <section
          className={`${styles.detailSection} ${styles.projectOverview}`}
          aria-label="프로젝트 개요"
        >
          <div className={styles.detailHeading}>
            <h2>목표와 설명</h2>
            <span>
              {spaceLabels[project.space]} · {dateLabel(project.createdAt)} 등록
            </span>
          </div>
          <p className={styles.projectDescription}>
            {project.currentStatus && (
              <span className={styles.projectStatusLine}>
                현재 상태: {project.currentStatus}
                <br />
              </span>
            )}
            {project.nextAction && (
              <span className={styles.projectStatusLine}>
                다음 행동: {project.nextAction}
                <br />
              </span>
            )}
            {project.description ||
              "어떤 일을 끝내려는 프로젝트인가요? 프로젝트 수정에서 목표와 현재 상황을 적어주세요."}
          </p>
          <div className={styles.projectProgress}>
            <span>업무 진행</span>
            <strong>
              {done} / {tasks.length}개 완료
            </strong>
            <progress
              aria-label="업무 완료율"
              value={done}
              max={Math.max(tasks.length, 1)}
            />
          </div>
          <dl className={styles.projectMetrics}>
            <div>
              <dt>남은 업무</dt>
              <dd>
                {tasks.length - done}
                <small>개</small>
              </dd>
            </div>
            <div>
              <dt>내 결정 필요</dt>
              <dd>
                {decisions.length}
                <small>개</small>
              </dd>
            </div>
            <div>
              <dt>관련 자료</dt>
              <dd>
                {documents.length}
                <small>개</small>
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.detailSection} aria-label="프로젝트 연결">
          <div className={styles.detailHeading}>
            <h2>
              <Icon name="link" size={17} /> 프로젝트 연결
            </h2>
          </div>
          <div className={styles.projectConnections}>
            {repositoryUrl ? (
              <a
                href={repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub 저장소 열기"
              >
                <Icon name="folder" size={18} />
                <div>
                  <strong>GitHub 저장소</strong>
                  <span>{repositoryUrl}</span>
                </div>
                <Icon name="arrow" size={16} />
              </a>
            ) : (
              <p>GitHub 저장소를 아직 등록하지 않았습니다.</p>
            )}
            {serviceUrl ? (
              <a
                href={serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="서비스 열기"
              >
                <Icon name="link" size={18} />
                <div>
                  <strong>서비스 열기</strong>
                  <span>{serviceUrl}</span>
                </div>
                <Icon name="arrow" size={16} />
              </a>
            ) : (
              <p>실행 중인 서비스 주소를 등록할 수 있습니다.</p>
            )}
          </div>
          <button
            className={styles.textButton}
            disabled={saving}
            onClick={() => setEditing(true)}
          >
            연결 주소 수정 <Icon name="plus" size={14} />
          </button>
          <p className={styles.detailFootnote}>
            등록한 주소를 새 탭으로 엽니다. 코드와 데이터의 자동 동기화는 아직
            연결되지 않았습니다.
          </p>
        </section>
        <SourceResults projectId={project.id} />
        <section className={styles.detailSection} aria-label="프로젝트 업무">
          <div className={styles.detailHeading}>
            <h2>
              <Icon name="check" size={17} /> 다음 할 일
            </h2>
            <button
              disabled={saving}
              onClick={() => void openWorkspace("/tasks")}
            >
              업무 관리 <Icon name="arrow" size={14} />
            </button>
          </div>
          {pending.length ? (
            <ul className={styles.detailList}>
              {pending.slice(0, 6).map((task) => (
                <li key={task.id}>
                  <button
                    disabled={saving}
                    onClick={() => void openWorkspace("/tasks")}
                  >
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.dueDate || "일정 미정"}</span>
                    </div>
                    <span
                      className={styles.detailBadge}
                      data-status={task.status}
                    >
                      {statusLabels[task.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.detailEmpty}>
              <p>
                {tasks.length
                  ? "등록한 업무를 모두 완료했습니다."
                  : "아직 등록한 업무가 없습니다."}
              </p>
              <button
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void openWorkspace("/tasks")}
              >
                할 일 등록하기 <Icon name="plus" size={14} />
              </button>
            </div>
          )}
        </section>
        <section className={styles.detailSection} aria-label="프로젝트 맥락">
          <div className={styles.detailHeading}>
            <h2>
              <Icon name="memory" size={17} /> 기억할 맥락
            </h2>
            <button disabled={saving} onClick={() => setContextOpen(true)}>
              맥락 편집
            </button>
          </div>
          {note?.content ? (
            <p className={styles.detailContext}>{note.content}</p>
          ) : (
            <div className={styles.detailEmpty}>
              <p>현재 상황, 결정한 내용, 업무 기준을 남겨주세요.</p>
              <button
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => setContextOpen(true)}
              >
                첫 맥락 기록 <Icon name="plus" size={14} />
              </button>
            </div>
          )}
          {note && (
            <p className={styles.detailFootnote}>
              버전 {note.revision} · {dateLabel(note.updatedAt)}
            </p>
          )}
          {revisions.length > 0 && (
            <details className={styles.contextHistory}>
              <summary>수정 이력 {revisions.length}개</summary>
              {revisions.map((revision) => (
                <details key={revision.id}>
                  <summary>
                    버전 {revision.revision} · {dateLabel(revision.createdAt)}
                  </summary>
                  <p>{revision.content || "빈 맥락"}</p>
                </details>
              ))}
            </details>
          )}
        </section>
        <section className={styles.detailSection} aria-label="프로젝트 자료">
          <div className={styles.detailHeading}>
            <h2>
              <Icon name="paperclip" size={17} /> 연결 자료{" "}
              <span>{documents.length}</span>
            </h2>
            <button
              disabled={saving}
              onClick={() => void openWorkspace("/library")}
            >
              자료 관리 <Icon name="arrow" size={14} />
            </button>
          </div>
          {documents.length ? (
            <ul className={styles.detailList}>
              {documents.slice(0, 6).map((file) => (
                <li key={file.id}>
                  <button
                    disabled={saving}
                    onClick={() => void openWorkspace("/library")}
                  >
                    <Icon name="note" size={18} />
                    <div>
                      <strong>{file.name}</strong>
                      <span>
                        {fileSize(file.size)} ·{" "}
                        {file.taskId
                          ? tasks.find((t) => t.id === file.taskId)?.title ||
                            "연결 업무"
                          : "프로젝트 공통 자료"}
                      </span>
                    </div>
                    <Icon name="arrow" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.detailEmpty}>
              <p>기획서, 메모, 결과물을 같은 프로젝트에 연결하세요.</p>
              <button
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void openWorkspace("/library")}
              >
                자료 연결하기 <Icon name="plus" size={14} />
              </button>
            </div>
          )}
        </section>
        <section className={styles.detailSection} aria-label="프로젝트 대화">
          <div className={styles.detailHeading}>
            <h2>
              <Icon name="message" size={17} /> 저장된 대화{" "}
              <span>{conversations.length}</span>
            </h2>
          </div>
          {conversations.length ? (
            <ul className={styles.detailList}>
              {conversations.slice(0, 6).map((conversation) => (
                <li key={conversation.id}>
                  <button
                    disabled={saving}
                    onClick={() =>
                      void openWorkspace("/assistant", conversation.id)
                    }
                  >
                    <div>
                      <strong>{conversation.title}</strong>
                      <span>{dateLabel(conversation.updatedAt)}</span>
                    </div>
                    <Icon name="arrow" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.detailEmpty}>
              <p>이 프로젝트의 대화가 여기에 모입니다.</p>
              <button
                className={styles.secondaryButton}
                disabled={saving}
                onClick={() => void openWorkspace("/assistant")}
              >
                첫 대화 남기기 <Icon name="message" size={14} />
              </button>
            </div>
          )}
        </section>
      </div>
      <div className={styles.homeSection}>
        <ServicesPanel projectId={project.id} />
      </div>
      <div className={styles.homeSection}>
        <RequestsPanel projectId={project.id} />
      </div>
      <div className={styles.homeSection}>
        <NotesPanel projectId={project.id} />
      </div>
      <details className={styles.homeDetails}>
        <summary>이 프로젝트 자료 검색 · AI 질문</summary>
        <SourcesPanel projectId={project.id} />
      </details>
      {editing && (
        <ProjectEditor project={project} onClose={() => setEditing(false)} />
      )}
      {contextOpen && (
        <ContextEditor
          projectId={project.id}
          onClose={() => setContextOpen(false)}
        />
      )}
    </div>
  );
}

function ProjectEditor({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { mutate, saving } = useWorkspace();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [currentStatus, setCurrentStatus] = useState(
    project.currentStatus ?? "",
  );
  const [nextAction, setNextAction] = useState(project.nextAction ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(
    project.repositoryUrl ?? "",
  );
  const [serviceUrl, setServiceUrl] = useState(project.serviceUrl ?? "");
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || pending.current || !name.trim()) return;
    pending.current = true;
    setError("");
    try {
      const links = {
        repositoryUrl: projectUrl(repositoryUrl, true),
        serviceUrl: projectUrl(serviceUrl),
      };
      await mutate((d) => {
        assertLinks(d, project.space, project.id);
        return {
          ...d,
          projects: d.projects.map((p) =>
            p.id === project.id
              ? {
                  ...p,
                  name: name.trim(),
                  description: description.trim(),
                  currentStatus: currentStatus.trim(),
                  nextAction: nextAction.trim(),
                  ...links,
                }
              : p,
          ),
        };
      });
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
      title="프로젝트 수정"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form className={styles.modalBody} onSubmit={save} aria-busy={saving}>
        <label className={styles.field}>
          프로젝트 이름
          <input
            aria-label="프로젝트 이름"
            autoFocus
            required
            maxLength={160}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          프로젝트 설명
          <textarea
            aria-label="프로젝트 설명"
            rows={5}
            maxLength={10000}
            value={description}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="목표와 현재 진행 상황, 다음 할 일을 적어주세요."
          />
        </label>
        <label className={styles.field}>
          현재 상태
          <input
            aria-label="프로젝트 현재 상태"
            maxLength={500}
            value={currentStatus}
            onChange={(event) => setCurrentStatus(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          다음에 할 일
          <input
            aria-label="프로젝트 다음 행동"
            maxLength={1000}
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          GitHub 저장소
          <input
            aria-label="GitHub 저장소"
            type="url"
            maxLength={2048}
            value={repositoryUrl}
            disabled={saving}
            onChange={(event) => setRepositoryUrl(event.target.value)}
            placeholder="https://github.com/소유자/저장소"
          />
        </label>
        <label className={styles.field}>
          서비스 주소
          <input
            aria-label="서비스 주소"
            type="url"
            maxLength={2048}
            value={serviceUrl}
            disabled={saving}
            onChange={(event) => setServiceUrl(event.target.value)}
            placeholder="https://서비스-주소"
          />
        </label>
        <p className={styles.modalDescription}>
          주소만 보관합니다. API 키나 비밀번호를 입력하지 마세요.
        </p>
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
            disabled={saving || !name.trim()}
          >
            {saving ? "저장 중…" : "변경 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
