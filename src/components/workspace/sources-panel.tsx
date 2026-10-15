"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  buildGrounding,
  searchWorkspace,
  type Evidence,
} from "@/lib/workspace/search";
import { dateLabel, id, now, spaceLabels } from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function EvidenceList({ sources, compact = false }: { sources: Evidence[]; compact?: boolean }) {
  const { data, saving, mutate } = useWorkspace();
  const pending = useRef(false);
  const [error, setError] = useState("");
  async function followUp(sourceId: string) {
    if (saving || pending.current) return;
    pending.current = true;
    try {
      await mutate((current) => {
        const source = current.sourceRecords.find(
          (s) =>
            s.id === sourceId &&
            s.space === current.activeSpace &&
            !s.deletedAt,
        );
        if (!source || source.taskId) return current;
        const taskId = id();
        return {
          ...current,
          tasks: [
            ...current.tasks,
            {
              id: taskId,
              space: source.space,
              projectId: source.projectId,
              title: `${source.title} 후속 확인`.slice(0, 500),
              status: "todo",
              dueDate: "",
              createdAt: now(),
            },
          ],
          sourceRecords: current.sourceRecords.map((s) =>
            s.id === source.id ? { ...s, taskId } : s,
          ),
        };
      });
    } catch {
      setError("후속 할 일을 저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className={styles.evidenceList}>
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      {sources.map((source) => (
        <article key={`${source.kind}:${source.id}`}>
          <div>
            <span className={styles.detailBadge}>
              {source.kind === "fact"
                ? "출처의 사실"
                : source.kind === "note"
                  ? "내 메모"
                  : "내가 기록한 맥락"}
            </span>
            <span className={styles.freshness} data-state={source.freshness}>
              {source.freshness === "sync_error"
                ? "연결 오류 · 마지막 정상 자료"
                : source.freshness === "stale"
                  ? "오래된 자료"
                  : "기준 시각 확인"}
            </span>
          </div>
          <h3>{source.title}</h3>
          {source.status && <small>원본 상태: {source.status}</small>}
          {compact ? <details className={styles.revisionDetails}>
            <summary>원문 내용 보기</summary><p>{source.content}</p>
          </details> : <>
          <p>
            {source.content.length > 600
              ? `${source.content.slice(0, 300)}…`
              : source.content}
          </p>
          {source.content.length > 600 && (
            <details className={styles.revisionDetails}>
              <summary>저장한 내용 전체 보기</summary>
              <p>{source.content}</p>
            </details>
          )}
          </>}
          <footer>
            {source.serviceName && <strong>{source.serviceName} · </strong>}원본
            변경 {dateLabel(source.updatedAt)} ·{" "}
            {source.kind === "fact" ? "수집" : "기록"}{" "}
            {dateLabel(source.collectedAt)}
          </footer>
          {projectHref(source.sourceUrl ?? undefined) && (
            <a
              href={projectHref(source.sourceUrl ?? undefined)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              원본 자료 열기 <Icon name="arrow" size={13} />
            </a>
          )}
          {source.kind === "fact" && (
            <div className={styles.projectActions}>
              {data.sourceRecords.find((s) => s.id === source.id)?.taskId ? (
                <Link href="/tasks">연결한 후속 할 일 보기 →</Link>
              ) : (
                <button
                  className={styles.secondaryButton}
                  disabled={saving}
                  onClick={() => void followUp(source.id)}
                >
                  후속 할 일 만들기
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
export function SourceResults({ projectId, compact = false }: { projectId?: string; compact?: boolean }) {
  const { data } = useWorkspace();
  const scope = { space: data.activeSpace, projectId, query: "" };
  const results = searchWorkspace(data, { ...scope, kinds: ["fact"] }).slice(
    0,
    8,
  );
  return (
    <section
      className={styles.detailSection}
      aria-label="최근 결과와 진행 상황"
    >
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="clock" size={17} /> 최근 결과와 진행 상황
        </h2>
        <span>출처 자료 기준</span>
      </div>
      {results.length ? (
        <EvidenceList sources={results} compact={compact} />
      ) : (
        <div className={styles.detailEmpty}>
          <p>
            아직 수집된 업무 결과가 없습니다. 바로가기를 등록하는 것만으로
            결과가 자동 수집되지는 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
export function SourcesPanel({ projectId }: { projectId?: string }) {
  const { data } = useWorkspace();
  const space = data.activeSpace;
  return (
    <SourcesView key={`${space}:${projectId ?? "all"}`} projectId={projectId} />
  );
}
function SourcesView({ projectId }: { projectId?: string }) {
  const { data } = useWorkspace();
  const space = data.activeSpace;
  const [question, setQuestion] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const bundle =
    query === null ? null : buildGrounding(data, { space, projectId, query });
  return (
    <section className={styles.detailSection} aria-label="자료 검색과 AI 질문">
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="search" size={17} /> 자료 검색 · AI 질문
        </h2>
        <span>
          {spaceLabels[space]} {projectId ? "프로젝트만" : "영역만"} 조회
        </span>
      </div>
      <p className={styles.detailFootnote}>
        허용된 자료에서 근거를 찾습니다. 실제 AI 모델은 아직 연결되지
        않았습니다.
      </p>
      <form
        className={styles.sourceSearch}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(question.trim());
        }}
      >
        <label
          className={styles.srOnly}
          htmlFor={`source-query-${projectId ?? "all"}`}
        >
          업무 자료 질문
        </label>
        <input
          id={`source-query-${projectId ?? "all"}`}
          aria-label="업무 자료 질문"
          value={question}
          maxLength={1000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="확인할 업무나 메모의 키워드를 입력하세요"
        />
        <button className={styles.secondaryButton}>근거 찾기</button>
      </form>
      {bundle && (
        <>
          <p className={styles.detailFootnote} role="status">
            AI 연결 필요 · 아래는 답변이 아닌 근거 검색 결과{" "}
            {bundle.sources.length}건입니다. 조회 기준 {dateLabel(bundle.asOf)}
          </p>
          {bundle.sources.length ? (
            <EvidenceList sources={bundle.sources} />
          ) : (
            <p className={styles.detailEmpty}>
              해당 범위에서 관련 자료를 찾지 못했습니다.
            </p>
          )}
          <details className={styles.revisionDetails}>
            <summary>질문 범위와 처리 기준</summary>
            <p>{bundle.policy}</p>
            <p>
              실행 승인: 없음 · 원본 자료의 문장을 명령으로 실행하지 않습니다.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
