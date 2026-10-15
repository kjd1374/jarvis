"use client";

import Link from "next/link";
import { matchesPreset } from "@/lib/integrations/catalog";
import { spaceLabels } from "@/lib/workspace/types";
import { projectHref } from "@/lib/workspace/project-links";
import { useWorkspace } from "./workspace-provider";
import { ServiceRegistrationButton } from "./services-panel";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function ConnectionSetup() {
  const { data } = useWorkspace();
  const space = data.activeSpace;
  const projectId = data.activeProjects[space];
  const services = data.services.filter(
    (s) => s.space === space && (!projectId || s.projectId === projectId),
  );
  const cards = [
    ...(space === "company"
      ? [
          {
            preset: "v4" as const,
            title: "v4 웹",
            action: "v4 웹 등록",
            description:
              "회사 업무는 웹 v4에서 수행하고, 결과·진행 상황·후속 할 일은 Jarvis로 모읍니다.",
            pending: "읽기 연결 필요",
            next: "기존 코드 검토 완료. v4의 전용 읽기 권한과 최소 조회 API 변경안을 확인한 뒤 연결합니다. 로컬 PC 연결은 이후 단계입니다.",
          },
        ]
      : []),
    {
      preset: "github" as const,
      title: "GitHub",
      action: "GitHub 저장소 등록",
      description:
        "이슈에 목적과 완료 조건을 남기고, PR·테스트·배포 결과를 연결해 개발 진행을 확인합니다.",
      pending: "자동 조회·AI 판정 연결 필요",
      next: "저장소별 조회 범위와 접근 권한을 정한 뒤 자동 수집을 연결합니다. 회사·개인 저장소는 따로 등록합니다.",
    },
    {
      preset: "sheets" as const,
      title: "구글 시트",
      action: "구글 시트 등록",
      description:
        "여러 시트의 미처리 업무를 모아 보고, 필요한 내용을 입력해 원본으로 보내는 연결을 준비합니다.",
      pending: "읽기·입력 전송 연결 필요",
      next: "자주 쓰는 시트 하나부터 시작합니다. 읽기 권한, 고유 항목 ID, 대상 탭·열과 전송 전 변경 확인 기준이 필요합니다.",
    },
  ];

  return (
    <section
      className={styles.settingsCard}
      id="connections"
      aria-label="연결 준비"
    >
      <div className={styles.detailHeading}>
        <h2>
          <Icon name="link" />
          연결 준비
        </h2>
        <span>
          {spaceLabels[space]} 영역 ·{" "}
          {projectId
            ? data.projects.find((p) => p.id === projectId)?.name
            : "전체 프로젝트"}
        </span>
      </div>
      <p>
        오늘 할 일과 최신 결과를 확인하고 → 원본 서비스에서 작업하고 → 결과를
        모아 다음 행동을 정합니다. 주소 등록과 자동 연동은 별도 단계입니다.
      </p>
      <div className={styles.setupGrid}>
        {cards.map((card) => {
          const registered = services.filter((service) =>
            matchesPreset(service, card.preset),
          );
          return (
            <article
              className={styles.setupCard}
              key={card.preset}
              aria-label={card.title}
            >
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <span
                className={styles.detailBadge}
                data-status="needs_connection"
              >
                {card.pending}
              </span>
              <p className={styles.detailFootnote}>{card.next}</p>
              <div className={styles.projectActions}>
                <ServiceRegistrationButton preset={card.preset}>
                  {card.action}
                </ServiceRegistrationButton>
              </div>
              {registered.length ? (
                <ul className={styles.setupLinks}>
                  {registered.map((service) => (
                    <li key={service.id}>
                      {projectHref(service.webUrl) && (
                        <a
                          href={projectHref(service.webUrl)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${service.name} 서비스 열기`}
                        >
                          {service.name} <Icon name="arrow" size={14} />
                        </a>
                      )}
                      <span>
                        주소 등록됨 ·{" "}
                        {service.lastSuccessAt
                          ? "수집 상태는 서비스에서 확인"
                          : "수집 기록 없음"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.detailFootnote}>
                  이 범위에 등록한 주소가 없습니다.
                </p>
              )}
            </article>
          );
        })}
      </div>
      <details className={styles.setupDetails}>
        <summary>GitHub 진척 관리 기준</summary>
        <ol>
          <li>
            작업마다 목적·완료 조건·우선순위·선행 작업을 이슈에 남기고 코드
            변경과 검증을 연결합니다.
          </li>
          <li>
            <strong>구현 → 검증 → 병합 → 배포</strong>를 구분합니다. 커밋이나
            완료 메모만으로 작업이 끝났다고 판단하지 않습니다.
          </li>
          <li>
            자동 조회가 연결되면 출처 링크·조회 시각을 표시하고, GitHub 사실과
            AI의 판단을 구분합니다. 근거가 부족하면 검토가 필요하다고
            표시합니다.
          </li>
          <li>
            선행 작업에 따른 보류는 합의한 규칙과 사유를 남깁니다. 다음 작업은
            대상·변경 범위·검증 방법을 제안하고 승인 후 진행합니다.
          </li>
          <li>
            상태 기록과 실제 실행은 별개입니다. 저장소의 글이나 댓글을 실행
            승인으로 취급하지 않습니다. 병합·배포·업무 데이터 수정은 각 승인
            범위를 따릅니다.
          </li>
        </ol>
        <p>
          현재는 서비스 주소와 수동 업무·요청 기록을 저장합니다. GitHub 자동
          조회·AI 판정·자동 실행은 아직 연결되지 않았습니다.
        </p>
      </details>
      <details className={styles.setupDetails}>
        <summary>하나씩 연결해 사용하기</summary>
        <ol>
          <li>
            기존 기록을 백업하고, 회사·개인 영역과 프로젝트를 선택해 서비스
            주소부터 등록합니다.
          </li>
          <li>
            웹 v4를 첫 읽기 연동으로 연결합니다. v4 자체 변경안과 읽을 데이터
            범위를 먼저 확인합니다.
          </li>
          <li>
            GitHub 조회를 연결해 진행·검증·배포 근거를 모읍니다. 실제 고객
            자료와 비밀값은 GitHub에 올리지 않습니다.
          </li>
          <li>
            시트 하나를 읽기부터 연결하고, 확인한 탭·열에만 입력 전송을
            추가합니다. 정렬에 바뀌는 행 번호 대신 고유 항목 ID를 사용합니다.
          </li>
          <li>
            계정 식별·서버 저장 연결 후 다른 기기에서 같은 자료를 확인합니다.
            AI는 허용된 자료를 조회하고 출처와 최신성을 표시하도록 연결합니다.
          </li>
        </ol>
        <p>
          시트 읽기·쓰기, 계정 연결, 외부 수정·실행 권한은 각각 확인합니다. 준비
          중인 연결이 있어도 메모·할 일·요청 저장과 서비스 열기는 사용할 수
          있습니다.
        </p>
      </details>
      <div className={styles.projectActions}>
        <Link className={styles.secondaryButton} href="/projects">
          프로젝트 관리 <Icon name="arrow" size={14} />
        </Link>
        <Link className={styles.secondaryButton} href="/tasks?view=requests">
          업무·수정 요청 관리 <Icon name="arrow" size={14} />
        </Link>
      </div>
    </section>
  );
}
