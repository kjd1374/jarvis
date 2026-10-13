"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  dateLabel,
  id,
  now,
  spaceLabels,
  statusLabels,
  today,
  updateContext,
  type Conversation,
} from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import { ContextEditor, Modal, WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function AgentWorkspace() {
  const { data } = useWorkspace();
  return (
    <AgentView
      key={`${data.activeSpace}:${data.activeProjects[data.activeSpace] ?? "all"}`}
    />
  );
}

function AgentView() {
  const { data, ready, saving, mutate } = useWorkspace();
  const space = data.activeSpace;
  const projectId = data.activeProjects[space];
  const conversations = data.conversations
    .filter(
      (c) => c.space === space && (!projectId || c.projectId === projectId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active =
    conversations.find((c) => c.id === data.activeConversations[space]) ??
    conversations[0];
  const [newConversation, setNewConversation] = useState(false);
  const conversation = newConversation ? undefined : active;
  const contextProjectId = conversation?.projectId ?? projectId;
  const messages = data.messages.filter(
    (m) => m.conversationId === conversation?.id,
  );
  const tasks = data.tasks.filter(
    (t) => t.space === space && (!projectId || t.projectId === projectId),
  );
  const contextTasks = tasks.filter(
    (t) => !contextProjectId || t.projectId === contextProjectId,
  );
  const documents = data.documents.filter(
    (f) =>
      f.space === space &&
      (!contextProjectId || f.projectId === contextProjectId),
  );
  const note = data.contexts.find(
    (c) => c.space === space && c.projectId === contextProjectId,
  );
  const general = contextProjectId
    ? data.contexts.find((c) => c.space === space && c.projectId === null)
    : undefined;
  const revisions = data.contextRevisions
    .filter((r) => r.contextId === note?.id)
    .slice()
    .reverse();
  const [mobileView, setMobileView] = useState<"chat" | "context">("chat");
  const [draft, setDraft] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [modal, setModal] = useState<"history" | "context" | "files" | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({
      top: log.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);
  const scopedAttachments = attachmentIds.filter((fileId) =>
    documents.some((d) => d.id === fileId),
  );

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || saving || !ready) return;
    const stamp = now();
    const value: Conversation = conversation ?? {
      id: id(),
      space,
      projectId,
      title: content.slice(0, 50),
      createdAt: stamp,
      updatedAt: stamp,
    };
    try {
      await mutate((d) => ({
        ...d,
        conversations: [
          ...d.conversations.filter((c) => c.id !== value.id),
          { ...value, updatedAt: stamp },
        ],
        messages: [
          ...d.messages,
          {
            id: id(),
            conversationId: value.id,
            content,
            fileIds: scopedAttachments,
            createdAt: stamp,
          },
        ],
        activeConversations: { ...d.activeConversations, [space]: value.id },
      }));
      setDraft("");
      setAttachmentIds([]);
      setNewConversation(false);
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "대화를 저장하지 못했습니다.",
      );
    }
  }

  async function remember(content: string, linkedProject: string | null) {
    try {
      await mutate((d) => {
        const current = d.contexts.find(
          (c) => c.space === space && c.projectId === linkedProject,
        );
        return updateContext(
          d,
          space,
          linkedProject,
          [current?.content, content].filter(Boolean).join("\n\n"),
        );
      });
      setNotice("누적 맥락에 추가했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    }
  }

  async function makeTask(content: string, messageId: string) {
    try {
      await mutate((d) =>
        d.tasks.some((t) => t.sourceMessageId === messageId)
          ? d
          : {
              ...d,
              tasks: [
                ...d.tasks,
                {
                  id: id(),
                  sourceMessageId: messageId,
                  space,
                  projectId: conversation?.projectId ?? projectId,
                  title: content.slice(0, 160),
                  status: "todo",
                  dueDate: today(),
                  createdAt: now(),
                },
              ],
            },
      );
      setNotice("오늘의 업무에 추가했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    }
  }

  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>YOUR WORK, IN CONTEXT</p>
          <h1>업무실</h1>
          <p>생각을 나누고, 맥락을 쌓고, 다음 일을 이어가는 공간.</p>
        </div>
        <span className={styles.headingMark}>
          <Icon name="spark" size={18} />
          JARVIS
        </span>
      </div>
      <div className={styles.summaryGrid}>
        {[
          {
            label: "오늘 할 일",
            value: tasks.filter(
              (t) => t.status !== "done" && t.dueDate && t.dueDate <= today(),
            ).length,
            icon: "check" as const,
            description: "오늘 일정과 미완료 업무",
          },
          {
            label: "진행 중",
            value: tasks.filter((t) => t.status === "in_progress").length,
            icon: "clock" as const,
            description: "계속 이어갈 업무",
          },
          {
            label: "내 결정 필요",
            value: tasks.filter((t) => t.status === "decision").length,
            icon: "help" as const,
            description: "선택을 기다리는 업무",
          },
        ].map((item) => (
          <Link href="/tasks" key={item.label} className={styles.summaryCard}>
            <span className={styles.summaryIcon}>
              <Icon name={item.icon} size={20} />
            </span>
            <div>
              <span>{item.label}</span>
              <strong>
                {item.value}
                <small>건</small>
              </strong>
            </div>
            <span className={styles.summaryDescription}>
              {item.description}
              <Icon name="chevron" size={13} />
            </span>
          </Link>
        ))}
      </div>
      <div className={styles.mobileTabs} aria-label="업무실 보기">
        <button
          aria-pressed={mobileView === "chat"}
          onClick={() => setMobileView("chat")}
        >
          AI 대화
        </button>
        <button
          aria-pressed={mobileView === "context"}
          onClick={() => setMobileView("context")}
        >
          맥락 · 자료
        </button>
      </div>
      <div className={styles.agentGrid} data-mobile-view={mobileView}>
        <section className={styles.chatPanel} aria-labelledby="chat-title">
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              <span className={styles.agentAvatar}>
                <Icon name="spark" size={21} />
              </span>
              <div>
                <h2 id="chat-title">Jarvis와 대화</h2>
                <span>
                  {conversation?.title ??
                    `${spaceLabels[space]} 업무의 새 대화`}
                </span>
              </div>
            </div>
            <div className={styles.chatTools}>
              <span className={styles.connectionBadge}>
                <span />
                AI 연결 대기
              </span>
              <button
                aria-label="이전 대화"
                onClick={() => setModal("history")}
              >
                <Icon name="clock" size={18} />
              </button>
              <button
                aria-label="새 대화"
                onClick={() => {
                  setNewConversation(true);
                  setDraft("");
                  setAttachmentIds([]);
                  setNotice("");
                  composer.current?.focus();
                }}
              >
                <Icon name="plus" size={19} />
              </button>
            </div>
          </div>
          <div className={styles.chatLog} ref={log} aria-label="대화 기록">
            {messages.length === 0 ? (
              <div className={styles.chatWelcome}>
                <div className={styles.welcomeMark}>
                  <Icon name="spark" size={37} />
                </div>
                <span className={styles.welcomeEyebrow}>
                  ONE PLACE. EVERY NEXT STEP.
                </span>
                <h3>오늘, 어떤 일을 진행할까요?</h3>
                <p>
                  생각을 적고 관련 자료를 연결해주세요.
                  <br />
                  대화와 업무 맥락을 보관해 다음에 이어갈 수 있습니다.
                </p>
                <div className={styles.promptCards}>
                  {[
                    {
                      icon: "check" as const,
                      title: "오늘의 업무 정리",
                      text: "오늘 해야 할 일을 정리하고 싶어. ",
                    },
                    {
                      icon: "folder" as const,
                      title: "자료와 함께 기획하기",
                      text: "연결한 자료를 바탕으로 기획을 정리하고 싶어. ",
                    },
                    {
                      icon: "clock" as const,
                      title: "진행 중인 일 이어가기",
                      text: "진행 중인 업무의 현재 상황과 다음 할 일을 정리하고 싶어. ",
                    },
                  ].map((prompt) => (
                    <button
                      key={prompt.title}
                      disabled={!ready}
                      onClick={() => {
                        setDraft(prompt.text);
                        composer.current?.focus();
                      }}
                    >
                      <Icon name={prompt.icon} size={18} />
                      <span>{prompt.title}</span>
                      <Icon name="arrow" size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.messageList}>
                {messages.map((message) => (
                  <article className={styles.message} key={message.id}>
                    <div className={styles.messageMeta}>
                      <span>나</span>
                      <time dateTime={message.createdAt}>
                        {dateLabel(message.createdAt)}
                      </time>
                    </div>
                    <div className={styles.messageBubble}>
                      {message.content}
                      {message.fileIds.length > 0 && (
                        <div className={styles.messageFiles}>
                          {message.fileIds.map((fileId) => (
                            <span key={fileId}>
                              <Icon name="paperclip" size={12} />
                              {data.documents.find((f) => f.id === fileId)
                                ?.name ?? "연결 자료"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={styles.messageActions}>
                      <button
                        disabled={saving}
                        onClick={() =>
                          void remember(
                            message.content,
                            conversation?.projectId ?? null,
                          )
                        }
                      >
                        <Icon name="memory" size={13} />
                        맥락에 추가
                      </button>
                      <button
                        disabled={saving}
                        onClick={() =>
                          void makeTask(message.content, message.id)
                        }
                      >
                        <Icon name="plus" size={13} />
                        업무로 연결
                      </button>
                    </div>
                  </article>
                ))}
                <div className={styles.pendingResponse}>
                  <Icon name="spark" size={17} />
                  <p>
                    대화가 저장되었습니다. AI 실행 도구를 연결하면 이 기록과
                    맥락을 바탕으로 이어갈 수 있습니다.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className={styles.composerArea}>
            {scopedAttachments.length > 0 && (
              <div className={styles.attachments}>
                {scopedAttachments.map((fileId) => (
                  <span key={fileId}>
                    <Icon name="paperclip" size={13} />
                    {documents.find((f) => f.id === fileId)?.name}
                    <button
                      aria-label="첨부 해제"
                      onClick={() =>
                        setAttachmentIds((values) =>
                          values.filter((value) => value !== fileId),
                        )
                      }
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form className={styles.composer} onSubmit={submit}>
              <textarea
                ref={composer}
                aria-label="Jarvis에게 전달할 내용"
                placeholder="생각, 업무 요청, 기억할 내용을 적어주세요…"
                value={draft}
                maxLength={50000}
                rows={2}
                disabled={!ready}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className={styles.composerBottom}>
                <button
                  type="button"
                  className={styles.attachButton}
                  aria-label="대화에 자료 연결"
                  disabled={!ready}
                  onClick={() => setModal("files")}
                >
                  <Icon name="paperclip" size={18} />
                  <span>자료 연결</span>
                </button>
                <div>
                  <span>
                    {spaceLabels[space]} 맥락 ·{" "}
                    {contextProjectId
                      ? data.projects.find((p) => p.id === contextProjectId)
                          ?.name
                      : "전체 업무"}
                  </span>
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={!ready || saving || !draft.trim()}
                    aria-label="대화 저장"
                  >
                    <Icon name="send" size={17} />
                  </button>
                </div>
              </div>
            </form>
            <div className={styles.composerHint}>
              <span>Enter 저장 · Shift+Enter 줄바꿈</span>
              <span>대화는 이 브라우저에 보관됩니다</span>
            </div>
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
          </div>
        </section>
        <aside className={styles.contextRail} aria-label="현재 업무 맥락">
          <section className={styles.railSection}>
            <div className={styles.railHeading}>
              <h2>
                <Icon name="memory" size={17} />
                누적 맥락
              </h2>
              <button
                aria-label="맥락 편집"
                disabled={!ready}
                onClick={() => setModal("context")}
              >
                편집
              </button>
            </div>
            <span className={styles.railScope}>
              {spaceLabels[space]} /{" "}
              {contextProjectId
                ? data.projects.find((p) => p.id === contextProjectId)?.name
                : "전체 업무"}
            </span>
            {general?.content && (
              <details className={styles.generalContext}>
                <summary>현재 영역의 공통 맥락</summary>
                <p>{general.content}</p>
              </details>
            )}
            <div className={styles.contextPreview}>
              {note?.content ? (
                <p>{note.content}</p>
              ) : (
                <>
                  <span className={styles.contextEmptyIcon}>
                    <Icon name="note" size={23} />
                  </span>
                  <h3>기억할 배경을 남겨주세요</h3>
                  <p>
                    목표, 업무 기준과 결정 사항을
                    <br />
                    계속 저장하고 업데이트할 수 있어요.
                  </p>
                  <button
                    className={styles.textButton}
                    disabled={!ready}
                    onClick={() => setModal("context")}
                  >
                    첫 맥락 기록 <Icon name="plus" size={13} />
                  </button>
                </>
              )}
            </div>
            <div className={styles.contextMeta}>
              <span>{note ? `버전 ${note.revision}` : "아직 기록 없음"}</span>
              <span>{note ? dateLabel(note.updatedAt) : ""}</span>
            </div>
            {revisions.length > 0 && (
              <details className={styles.revisionDetails}>
                <summary>
                  맥락 수정 이력 <span>{revisions.length}</span>
                </summary>
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
          <section className={styles.railSection}>
            <div className={styles.railHeading}>
              <h2>
                <Icon name="paperclip" size={17} />
                관련 자료
              </h2>
              <Link href="/library">
                자료실 <Icon name="arrow" size={12} />
              </Link>
            </div>
            {documents.length ? (
              <div className={styles.railFiles}>
                {documents.slice(0, 4).map((file) => (
                  <Link href="/library" key={file.id}>
                    <span>
                      <Icon name="note" size={17} />
                    </span>
                    <div>
                      <strong>{file.name}</strong>
                      <small>
                        {file.projectId
                          ? data.projects.find((p) => p.id === file.projectId)
                              ?.name
                          : "영역 공통 자료"}
                      </small>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className={styles.railEmpty}>
                <p>연결된 자료가 없습니다.</p>
                <Link href="/library">
                  파일을 올리고 업무에 연결하세요{" "}
                  <Icon name="arrow" size={13} />
                </Link>
              </div>
            )}
          </section>
          <section className={styles.railSection}>
            <div className={styles.railHeading}>
              <h2>
                <Icon name="check" size={17} />
                연결 업무
              </h2>
              <Link href="/tasks">
                전체 <Icon name="arrow" size={12} />
              </Link>
            </div>
            {contextTasks.filter((t) => t.status !== "done").length ? (
              <div className={styles.railTasks}>
                {contextTasks
                  .filter((t) => t.status !== "done")
                  .slice(0, 4)
                  .map((task) => (
                    <Link href="/tasks" key={task.id}>
                      <span className={styles.taskDot} />
                      <strong>{task.title}</strong>
                      <small>{statusLabels[task.status]}</small>
                    </Link>
                  ))}
              </div>
            ) : (
              <div className={styles.railEmpty}>
                <p>아직 연결한 업무가 없습니다.</p>
                <Link href="/tasks">
                  첫 업무 만들기 <Icon name="plus" size={13} />
                </Link>
              </div>
            )}
          </section>
          <div className={styles.railFootnote}>
            <Icon name="link" size={14} />
            <span>
              대화·맥락·자료가 같은 업무에 연결됩니다.
              <br />
              회사와 개인의 기록은 따로 보관합니다.
            </span>
          </div>
        </aside>
      </div>
      {modal === "context" && (
        <ContextEditor
          projectId={contextProjectId}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "history" && (
        <Modal title="저장된 대화" onClose={() => setModal(null)}>
          <div className={styles.modalBody}>
            <p className={styles.modalDescription}>
              {spaceLabels[space]} 영역의 대화 기록입니다.
            </p>
            <div className={styles.historyList}>
              {conversations.length ? (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    disabled={saving}
                    onClick={() =>
                      void mutate((d) => ({
                        ...d,
                        activeConversations: {
                          ...d.activeConversations,
                          [space]: c.id,
                        },
                      }))
                        .then(() => {
                          setNewConversation(false);
                          setModal(null);
                        })
                        .catch(() => {})
                    }
                  >
                    <Icon name="message" size={19} />
                    <div>
                      <strong>{c.title}</strong>
                      <span>
                        {dateLabel(c.updatedAt)} ·{" "}
                        {
                          data.messages.filter((m) => m.conversationId === c.id)
                            .length
                        }
                        개 기록
                      </span>
                    </div>
                    <Icon name="chevron" size={16} />
                  </button>
                ))
              ) : (
                <p className={styles.emptyText}>아직 저장된 대화가 없습니다.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === "files" && (
        <Modal title="대화에 자료 연결" onClose={() => setModal(null)}>
          <div className={styles.modalBody}>
            <p className={styles.modalDescription}>
              {spaceLabels[space]} 영역에서 현재 프로젝트에 해당하는 자료만
              표시합니다.
            </p>
            <div className={styles.filePicker}>
              {documents.length ? (
                documents.map((file) => (
                  <label key={file.id}>
                    <input
                      type="checkbox"
                      checked={scopedAttachments.includes(file.id)}
                      onChange={(event) =>
                        setAttachmentIds((values) =>
                          event.target.checked
                            ? [...values, file.id]
                            : values.filter((value) => value !== file.id),
                        )
                      }
                    />
                    <Icon name="note" size={18} />
                    <span>{file.name}</span>
                  </label>
                ))
              ) : (
                <p className={styles.emptyText}>
                  자료실에 파일을 추가하면 여기서 연결할 수 있습니다.
                </p>
              )}
            </div>
            <div className={styles.modalActions}>
              <Link
                href="/library"
                className={styles.secondaryButton}
                onClick={() => setModal(null)}
              >
                자료실 열기
              </Link>
              <button
                className={styles.primaryButton}
                onClick={() => setModal(null)}
              >
                연결 적용
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
