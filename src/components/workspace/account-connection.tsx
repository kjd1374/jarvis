"use client";
import { useState } from "react";
import { accountAction } from "@/lib/cloud/client";
import { useWorkspace } from "./workspace-provider";
import styles from "./studio.module.css";
export function AccountConnection() {
  const { account, retryLoad } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!account?.enabled) return null;
  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await accountAction("logout");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "기기 연결을 확인해주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="account"
      className={styles.settingsCard}
      aria-label="이 기기와 서버 저장"
    >
      <h2>서버 저장 · 이 기기 연결</h2>
      {account.authenticated ? (
        <>
          <p>
            이 기기가 개인 업무실에 연결돼 있습니다. 이메일이나 로그인 화면 없이
            회사·개인 기록을 구분해 서버에 보관합니다.
          </p>
          <p className={styles.settingsNote}>
            연결을 해제해도 서버 기록과 이 기기의 저장 대기는 삭제하지 않습니다.
            다시 사용하려면 이 기기 확인이 필요합니다.
          </p>
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void disconnect()}
          >
            이 기기 연결 해제
          </button>
        </>
      ) : (
        <>
          <p>
            이메일·비밀번호 입력 없이 사용합니다. 처음에는 이 브라우저를 내
            기기로 확인한 뒤 자동으로 연결합니다.
          </p>
          {account.pairingCode ? (
            <>
              <p>
                기기 확인 번호: <strong>{account.pairingCode}</strong>
              </p>
              <p>
                이 번호는 비밀번호가 아닌 연결 요청 번호입니다. 이 작업의 채팅에
                알려주시면 해당 기기만 등록합니다.
              </p>
            </>
          ) : (
            <p role="status">
              이 기기의 연결을 준비하고 있습니다. 서버 설정이 완료됐는지
              확인해주세요.
            </p>
          )}
          <button className={styles.secondaryButton} onClick={retryLoad}>
            기기 연결 다시 확인
          </button>
        </>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
