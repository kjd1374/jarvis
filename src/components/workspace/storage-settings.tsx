"use client";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import { DataTransferPanel } from "./data-transfer-panel";
import { ConnectionSetup } from "./connection-setup";
import { StorageRecovery } from "./storage-recovery";
import styles from "./studio.module.css";

export function StorageSettings() {
  const { data, ready } = useWorkspace();
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
      <ConnectionSetup />
      <DataTransferPanel />
      <StorageRecovery />
      <section className={styles.settingsCard}>
        <h2>
          <Icon name="memory" />
          기록과 보관
        </h2>
        <p>
          대화, 업무 맥락, 파일과 연결 정보를 이 브라우저에 자동 저장합니다.
          같은 주소·기기·브라우저에서 다시 열면 이어서 사용할 수 있습니다.
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
          브라우저 데이터를 삭제하면 보관 내용도 삭제됩니다. 다른 기기와
          공유하려면 서버 저장 연결이 필요합니다.
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
              인증된 서버 저장 코드는 준비했습니다. 위에서 현재 계정·저장 연결
              상태를 확인하고 검토 후 이관합니다. 운영 기본은 비활성입니다.
            </p>
          </div>
          <span>연결 대기</span>
        </div>
      </section>
    </div>
  );
}
