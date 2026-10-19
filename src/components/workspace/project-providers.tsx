"use client";
import { useState } from "react";
import type { Space } from "@/lib/workspace/types";
import { useWorkspace } from "./workspace-provider";
import styles from "./studio.module.css";
export function ProjectProviders({ space }: { space: Space }) {
  const { account, data } = useWorkspace();
  const [provider, setProvider] = useState("vercel"), [token, setToken] = useState(""), [organization, setOrganization] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save(action: "connect" | "disconnect") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/automation/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ space, provider, action, ...(action === "connect" ? { token, organization } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "계정 연결을 저장하지 못했습니다.");
      setToken(""); setMessage(action === "connect" ? "이 영역의 계정을 연결했습니다. 이후 프로젝트에서 자동으로 사용합니다. 준비가 멈췄던 프로젝트는 이어서 준비를 누르세요." : "연결 정보를 제거했습니다. 이미 만든 외부 프로젝트는 유지됩니다.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "연결을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <details className={styles.compactDisclosure}>
    <summary>클라우드 계정 연결 · 선택 사항</summary>
    <p>계정을 한 번 연결하면 같은 영역의 새 프로젝트에서 재사용합니다. 연결하지 않으면 맥미니로 시작합니다. 토큰은 서버에서 암호화하며 AI 대화와 GitHub에 전달하지 않습니다.</p>
    {Object.entries(data.providerConnections?.[space] ?? {}).map(([key, value]) => <p key={key}>{value.label}</p>)}
    <label className={styles.field}>서비스<select value={provider} onChange={e => { setProvider(e.target.value); setToken(""); setOrganization(""); }}><option value="vercel">Vercel · 무료 Hobby</option><option value="supabase">Supabase · 무료 프로젝트</option></select></label>
    <label className={styles.field}>접근 토큰<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} maxLength={2000} /></label>
    <label className={styles.field}>{provider === "supabase" ? "Supabase 조직 ID" : "Vercel 팀 ID (개인은 비워두기)"}<input autoComplete="off" value={organization} onChange={e => setOrganization(e.target.value)} maxLength={100} /></label>
    <a href={provider === "vercel" ? "https://vercel.com/account/settings/tokens" : "https://supabase.com/dashboard/account/tokens"} target="_blank" rel="noopener noreferrer">서비스에서 접근 토큰 관리 ↗</a>
    <div className={styles.agentTurnActions}><button type="button" className={styles.secondaryButton} disabled={busy || !account?.authenticated || !token} onClick={() => void save("connect")}>계정 연결 저장</button><button type="button" className={styles.textButton} disabled={busy || !account?.authenticated} onClick={() => void save("disconnect")}>계정 연결 해제</button></div>
    {message && <p role="status">{message}</p>}
  </details>;
}
