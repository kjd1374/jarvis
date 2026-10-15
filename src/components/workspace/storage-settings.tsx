"use client";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { CliRunnerSetup } from "./github-monitor";
import { Icon } from "./icon";
import { DataTransferPanel } from "./data-transfer-panel";
import { ConnectionSetup } from "./connection-setup";
import { StorageRecovery } from "./storage-recovery";
import { AccountConnection } from "./account-connection";
import { CloudConflictReview } from "./cloud-conflict";
import styles from "./studio.module.css";

export function StorageSettings() {
  const { data, ready, account, conflict } = useWorkspace();
  const space = data.activeSpace;
  return (
    <div className={styles.studio}>
      <WorkspaceControls />
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>WORKSPACE SETTINGS</p>
          <h1>설정</h1>
          <p>업무실의 저장 방식과 연결 상태를 확인하세요.</p>
        </div>
      </div>
      <AccountConnection />
      <CloudConflictReview key={conflict?.reviewId ?? "none"} />
      <ConnectionSetup />
      <CliRunnerSetup />
      <DataTransferPanel />
      {(!account?.enabled || account.authenticated) && <StorageRecovery />}
      <section className={styles.settingsCard}>
        <h2>
          <Icon name="memory" />
          기록과 보관
        </h2>
        <p>
          {account?.enabled
            ? "서버에 업무 기록을 보관하고, 이 기기의 사본과 저장 대기를 별도로 유지합니다. 등록된 다른 기기에서도 같은 업무실을 불러옵니다."
            : "대화, 업무 맥락, 파일과 연결 정보를 이 브라우저에 자동 저장합니다. 같은 주소·기기·브라우저에서 다시 열면 이어서 사용할 수 있습니다."}
        </p>
        {ready ? (
          <div className={styles.settingsCounts}>
            <span>
              프로젝트{" "}
              <strong>
                {data.projects.filter((r) => r.space === space).length}
              </strong>
            </span>
            <span>
              대화{" "}
              <strong>
                {data.conversations.filter((r) => r.space === space).length}
              </strong>
            </span>
            <span>
              맥락{" "}
              <strong>
                {data.contexts.filter((r) => r.space === space).length}
              </strong>
            </span>
            <span>
              자료{" "}
              <strong>
                {data.documents.filter((r) => r.space === space).length}
              </strong>
            </span>
            <span>
              업무{" "}
              <strong>
                {data.tasks.filter((r) => r.space === space).length}
              </strong>
            </span>
          </div>
        ) : (
          <p>
            저장된 기록을 아직 확인하지 못했습니다. 위에서 다시 불러오거나 저장
            상태를 확인하세요.
          </p>
        )}
        <p className={styles.settingsNote}>
          {account?.enabled
            ? "서버 저장 완료 기록은 브라우저 데이터가 없어져도 등록된 기기에서 다시 불러옵니다. 전송되지 않은 저장 대기는 이 기기에만 남아 있으므로 서버 저장 상태를 확인하세요."
            : "브라우저 데이터를 삭제하면 보관 내용도 삭제됩니다. 다른 기기와 공유하려면 서버 저장 연결이 필요합니다."}
        </p>
      </section>
      <section className={styles.settingsCard}>
        <h2>
          <Icon name="link" />
          서비스 연결
        </h2>
        <div className={styles.connectionRow}>
          <div>
            <strong>AI 대화 / 실행</strong>
            <p>
              대화와 맥락은 저장됩니다. 실제 AI 응답과 실행 도구 연결은 다음
              단계입니다.
            </p>
          </div>
          <span>연결 대기</span>
        </div>
        <div className={styles.connectionRow}>
          <div>
            <strong>Supabase 업무 데이터 동기화</strong>
            <p>
              {account?.enabled
                ? "등록된 기기의 변경을 서버에 자동 저장합니다. 서버 오류와 충돌은 별도로 표시하며, 이전 브라우저 자료는 확인 후 가져옵니다."
                : "인증된 서버 저장 코드는 준비했습니다. 위에서 현재 계정·저장 연결 상태를 확인하고 검토 후 이관합니다. 운영 기본은 비활성입니다."}
            </p>
          </div>
          <span>
            {account?.enabled && account.authenticated
              ? "기기 연결됨"
              : "연결 대기"}
          </span>
        </div>
      </section>
    </div>
  );
}
