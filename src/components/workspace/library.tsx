"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  assertLinks,
  dateLabel,
  fileSize,
  id,
  now,
  spaceLabels,
  type Document,
} from "@/lib/workspace/types";
import { readFile } from "@/lib/workspace/storage";
import { downloadCloudFile } from "@/lib/cloud/client";
import { projectUrl } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { Modal, WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function Library() {
  const { data } = useWorkspace();
  return (
    <LibraryView
      key={`${data.activeSpace}:${data.activeProjects[data.activeSpace]}`}
    />
  );
}

function LibraryView() {
  const { data, ready, saving, mutate, account } = useWorkspace();
  const space = data.activeSpace;
  const projectId = data.activeProjects[space];
  const projects = data.projects.filter((p) => p.space === space);
  const documents = data.documents.filter(
    (d) => d.space === space && (!projectId || d.projectId === projectId) && (!d.sheet || !!d.sheet.archivedAt),
  );
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [selected, setSelected] = useState<Document | null>(null);
  const [linkProject, setLinkProject] = useState("");
  const [linkTask, setLinkTask] = useState("");
  const [uploadTask, setUploadTask] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceName, setReferenceName] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const uploading = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const filtered = documents.filter(
    (d) =>
      d.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (!taskFilter || d.taskId === taskFilter),
  );

  async function upload(files: File[]) {
    if (!ready || saving || uploading.current || !files.length) return;
    if (files.some((f) => f.size > 20 * 1024 * 1024)) {
      setError("파일당 20 MB까지 추가할 수 있습니다.");
      return;
    }
    uploading.current = true;
    const records: Document[] = files.map((file) => ({
      id: id(),
      space,
      name: file.name,
      mime: file.type,
      size: file.size,
      projectId,
      taskId: uploadTask || null,
      createdAt: now(),
    }));
    try {
      await mutate(
        (d) => {
          assertLinks(d, space, projectId, uploadTask || null);
          return { ...d, documents: [...d.documents, ...records] };
        },
        records.map((record, index) => ({ id: record.id, blob: files[index] })),
      );
      setNotice(`${files.length}개 자료를 저장했습니다.`);
      setError("");
      if (input.current) input.current.value = "";
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "파일을 저장하지 못했습니다.",
      );
    } finally {
      uploading.current = false;
    }
  }

  async function addReference(event: React.FormEvent) {
    event.preventDefault();
    if (saving || uploading.current || !referenceName.trim()) return;
    uploading.current = true;
    try {
      const sourceUrl = projectUrl(referenceUrl);
      if (!sourceUrl) throw new Error("원본 주소를 입력해주세요.");
      const record: Document = {
        id: id(),
        space,
        projectId,
        taskId: uploadTask || null,
        name: referenceName.trim(),
        sourceUrl,
        mime: "text/uri-list",
        size: 0,
        createdAt: now(),
      };
      await mutate((d) => {
        assertLinks(d, space, projectId, record.taskId);
        return { ...d, documents: [...d.documents, record] };
      });
      setReferenceOpen(false);
      setReferenceName("");
      setReferenceUrl("");
      setError("");
      setNotice(
        "원본 링크와 연결 정보를 저장했습니다. 파일 내용은 복제하지 않았습니다.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "링크를 저장하지 못했습니다.",
      );
    } finally {
      uploading.current = false;
    }
  }

  async function download(file: Document) {
    try {
      const blob = await readFile(file.id).catch(() =>
        downloadCloudFile(file.space, file.id),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "파일을 열 수 없습니다.",
      );
    }
  }

  async function saveLinks(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      await mutate((d) => {
        assertLinks(d, space, linkProject || null, linkTask || null);
        return {
          ...d,
          documents: d.documents.map((file) =>
            file.id === selected.id && file.space === space
              ? {
                  ...file,
                  projectId: linkProject || null,
                  taskId: linkTask || null,
                }
              : file,
          ),
        };
      });
      setSelected(null);
      setNotice("프로젝트와 업무 연결을 저장했습니다.");
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "연결하지 못했습니다.");
    }
  }

  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>FILES & DELIVERABLES</p>
          <h1>자료실</h1>
          <p>
            파일과 결과물을 프로젝트·업무에 연결하고, 대화에서 함께 참조하세요.
          </p>
        </div>
        <div className={styles.projectActions}>
          <button
            className={styles.secondaryButton}
            disabled={!ready || saving}
            onClick={() => {
              setError("");
              setReferenceOpen(true);
            }}
          >
            원본 링크 등록
          </button>
          <button
            className={styles.primaryButton}
            disabled={!ready || saving}
            onClick={() => input.current?.click()}
          >
            <Icon name="plus" size={17} />
            자료 추가
          </button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        aria-label="자료 파일 선택"
        className={styles.srOnly}
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <span className={styles.dropIcon}>
          <Icon name="folder" size={27} />
        </span>
        <div>
          <strong>업무에 필요한 자료를 모아주세요</strong>
          <p>
            파일을 끌어다 놓거나{" "}
            <button
              disabled={!ready || saving}
              onClick={() => input.current?.click()}
            >
              선택해서 추가
            </button>
            하세요. 파일당 최대 20 MB.
          </p>
        </div>
        <label>
          새 파일의 연결 업무
          <select
            aria-label="새 파일의 연결 업무"
            value={uploadTask}
            onChange={(event) => setUploadTask(event.target.value)}
          >
            <option value="">프로젝트 / 영역 공통 자료</option>
            {data.tasks
              .filter((t) => t.space === space && t.projectId === projectId)
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className={styles.libraryToolbar}>
        <label className={styles.librarySearch}>
          <Icon name="search" size={16} />
          <input
            aria-label="자료 검색"
            placeholder="자료 이름 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="연결 업무 필터"
          value={taskFilter}
          onChange={(event) => setTaskFilter(event.target.value)}
        >
          <option value="">모든 업무의 자료</option>
          {data.tasks
            .filter(
              (t) =>
                t.space === space && (!projectId || t.projectId === projectId),
            )
            .map((t) => (
              <option value={t.id} key={t.id}>
                {t.title}
              </option>
            ))}
        </select>
        <span>{filtered.length}개 자료</span>
      </div>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <section className={styles.libraryTable} aria-label="보관 자료">
        <div className={styles.libraryTableHeading}>
          <span>자료</span>
          <span>연결 프로젝트 / 업무</span>
          <span>보관일</span>
          <span>관리</span>
        </div>
        {filtered.length ? (
          filtered.map((file) => (
            <article className={styles.fileRow} key={file.id}>
              <div className={styles.fileName}>
                <span>
                  <Icon name="note" size={22} />
                </span>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {file.sheet ? `시트 보관 · ${file.sheet.tabs.filter(t => t.snapshotId).length}개 탭의 불러온 범위 · 문답 ${file.sheet.questions.length}개` : file.sourceUrl
                      ? "원본 링크 · 내용 미복제"
                      : `${fileSize(file.size)} · ${file.name.split(".").pop()?.toUpperCase() || "FILE"}`}
                  </small>
                </div>
              </div>
              <div className={styles.fileLinks}>
                <span>
                  {file.projectId
                    ? projects.find((p) => p.id === file.projectId)?.name
                    : `${spaceLabels[space]} 공통 자료`}
                </span>
                {file.taskId && (
                  <small>
                    {data.tasks.find((t) => t.id === file.taskId)?.title}
                  </small>
                )}
              </div>
              <time dateTime={file.createdAt}>{dateLabel(file.createdAt)}</time>
              <div className={styles.fileActions}>
                {file.sheet && <Link href={`/tasks?document=${file.id}`} aria-label={`${file.name} 보기·질문`}>보기·질문</Link>}
                <button
                  disabled={saving}
                  aria-label={`${file.name} 연결 설정`}
                  onClick={() => {
                    setSelected(file);
                    setLinkProject(file.projectId ?? "");
                    setLinkTask(file.taskId ?? "");
                    setError("");
                  }}
                >
                  <Icon name="link" size={17} />
                </button>
                {file.sourceUrl ? (
                  <a
                    href={file.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${file.name} 원본 열기`}
                  >
                    <Icon name="arrow" size={17} />
                  </a>
                ) : (
                  <button
                    aria-label={`${file.name} 다운로드`}
                    onClick={() => void download(file)}
                  >
                    <Icon name="download" size={17} />
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className={styles.emptyState}>
            <span>
              <Icon name="folder" size={34} />
            </span>
            <h2>
              {documents.length
                ? "검색한 자료가 없습니다"
                : "자료가 업무의 맥락이 됩니다"}
            </h2>
            <p>
              {documents.length
                ? "검색어나 업무 필터를 바꿔보세요."
                : "기획서, 메모, 참고 파일과 결과물을 올리고 관련 업무에 연결해보세요."}
            </p>
          </div>
        )}
      </section>
      <p className={styles.storageNote}>
        <Icon name="memory" size={14} />
        {account?.enabled
          ? "등록된 기기의 파일 원본은 비공개 서버 저장소에 보관합니다. 원본 링크는 내용을 복제하지 않습니다. 서버 전송 실패는 저장 대기로 표시합니다."
          : "기본 저장은 이 브라우저입니다. 원본 링크는 내용을 복제하지 않습니다. 설정에서 백업·이관과 서버 연결 상태를 확인하세요."}
      </p>
      {referenceOpen && (
        <Modal
          title="원본 링크 등록"
          onClose={() => {
            if (!saving) setReferenceOpen(false);
          }}
        >
          <form className={styles.modalBody} onSubmit={addReference}>
            <p className={styles.modalDescription}>
              {spaceLabels[space]} · 현재 프로젝트와 선택한 업무에 원본 주소만
              연결합니다. 비밀값이 포함된 주소는 등록하지 마세요.
            </p>
            <label className={styles.field}>
              자료 이름
              <input
                aria-label="원본 자료 이름"
                autoFocus
                required
                maxLength={200}
                value={referenceName}
                onChange={(e) => setReferenceName(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              원본 주소
              <input
                aria-label="원본 자료 주소"
                type="url"
                required
                maxLength={2048}
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
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
                disabled={saving}
                onClick={() => setReferenceOpen(false)}
              >
                취소
              </button>
              <button
                className={styles.primaryButton}
                disabled={saving || !referenceName.trim()}
              >
                원본 링크 저장
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title="자료 연결 설정" onClose={() => setSelected(null)}>
          <form className={styles.modalBody} onSubmit={saveLinks}>
            <p className={styles.modalDescription}>
              {selected.name} · {spaceLabels[space]} 영역
            </p>
            <label className={styles.field}>
              연결 프로젝트
              <select
                aria-label="연결 프로젝트"
                value={linkProject}
                onChange={(event) => {
                  setLinkProject(event.target.value);
                  setLinkTask("");
                }}
              >
                <option value="">영역 공통 자료</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              연결 업무
              <select
                aria-label="연결 업무"
                value={linkTask}
                onChange={(event) => setLinkTask(event.target.value)}
              >
                <option value="">특정 업무에 연결하지 않음</option>
                {data.tasks
                  .filter(
                    (t) =>
                      t.space === space &&
                      t.projectId === (linkProject || null),
                  )
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <p className={styles.modalDescription}>
              같은 영역의 프로젝트와 업무에 연결할 수 있습니다. 해당 맥락의
              대화에서 이 자료를 선택할 수 있습니다.
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
                onClick={() => setSelected(null)}
              >
                취소
              </button>
              <button className={styles.primaryButton} disabled={saving}>
                연결 저장
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
