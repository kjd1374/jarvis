"use client";

import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { Icon } from "./icon";
import styles from "./studio.module.css";

export function StorageSettings() {
  const { data } = useWorkspace();
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
      <section className={styles.settingsCard}>
        <h2>
          <Icon name="memory" />
          기록과 보관
        </h2>
        <p>
          대화, 업무 맥락, 파일과 연결 정보를 이 브라우저에 자동 저장합니다.
          같은 기기와 브라우저에서 다시 열면 이어서 사용할 수 있습니다.
        </p>
        <div className={styles.settingsCounts}>
          <span>
            대화 <strong>{data.conversations.length}</strong>
          </span>
          <span>
            맥락 <strong>{data.contexts.length}</strong>
          </span>
          <span>
            자료 <strong>{data.documents.length}</strong>
          </span>
          <span>
            업무 <strong>{data.tasks.length}</strong>
          </span>
        </div>
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
              프로젝트 기반은 준비되어 있으며 업무 기록과 파일의 서버 동기화는
              아직 연결되지 않았습니다.
            </p>
          </div>
          <span>연결 대기</span>
        </div>
        <div className={styles.connectionRow}>
          <div>
            <strong>v4 · 회사 통화 / 고객관리</strong>
            <p>회사 영역의 업무와 자료로 연결할 모듈입니다.</p>
          </div>
          <span>연결 예정</span>
        </div>
      </section>
    </div>
  );
}
