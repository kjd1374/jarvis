"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "./workspace-provider";
import { WorkspaceControls } from "./workspace-controls";
import { id, now, type Document } from "@/lib/workspace/types";
import { addSheet, archiveSheet, DEFAULT_RANGE, parseSheetRange, replaceSheet, saveSheetSnapshot, sheetUrl } from "@/lib/sheets/documents";
import { changeDocumentQuestion, enqueueDocumentQuestion } from "@/lib/sheets/questions";
import { chooseSheet, connectGoogle, forgetGoogleToken, hasGoogleSession, prepareGoogle, readSheetMetadata, readSheetValues, type GoogleConfig } from "@/lib/sheets/google-browser";
import type { DocumentQuestion, SheetSnapshot, SheetTab } from "@/lib/sheets/types";
import { SheetGrid } from "./sheet-grid";
import { useSheetViewPreference } from "./sheet-view-preference";
import studio from "./studio.module.css";
import styles from "./sheet-workspace.module.css";

const time = (value: string) => new Date(value).toLocaleString("ko-KR");
const questionStatus = { queued: "실행기 응답 대기", running: "답변 작성 중", completed: "답변 완료", failed: "답변 실패", interrupted: "실행 중단 · 재시도 가능", cancelled: "취소됨" };
const errors: Record<string, string> = { cli_login_required: "맥미니에서 Codex의 ChatGPT 구독 로그인을 확인해주세요.", cli_limit: "구독 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.", cli_unavailable: "맥미니의 Codex CLI 상태를 확인해주세요.", imported_request_review: "백업에서 가져온 질문입니다. 원하면 다시 요청해주세요.", runner_interrupted: "실행기 응답이 끊겼습니다. 맥미니를 확인한 뒤 다시 요청해주세요." };

export function SheetWorkspace({ initialDocument }: { initialDocument?: string }) {
  const { data, account } = useWorkspace();
  useEffect(() => () => forgetGoogleToken(), [account?.accountId]);
  return <SheetWorkspaceView key={`${account?.accountId ?? "local"}:${data.activeSpace}:${data.activeProjects[data.activeSpace]}:${initialDocument ?? ""}`} initialDocument={initialDocument} />;
}
function SheetWorkspaceView({ initialDocument }: { initialDocument?: string }) {
  const { data, ready, saving, account, mutate, retryLoad, error: storageError } = useWorkspace();
  const space = data.activeSpace, projectId = data.activeProjects[space];
  const all = data.documents.filter(d => d.space === space && (!projectId || d.projectId === projectId) && d.sheet);
  const [selectedId, setSelectedId] = useState(initialDocument ?? "");
  const [tabId, setTabId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingTab, setLoadingTab] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [configChecked, setConfigChecked] = useState(false);
  const mounted = useRef(true), working = useRef(false);
  const selectionGeneration = useRef(0), autoAttempts = useRef(new Set<string>());
  const preferenceScope = `jarvis-sheet-view:${account?.accountId ?? "local"}:${space}`;
  const [questionVisibility, saveQuestionVisibility] = useSheetViewPreference(`${preferenceScope}:questions`);
  const questionsCollapsed = questionVisibility === "collapsed";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!account?.authenticated) return;
    let active = true;
    void fetch("/api/sheets/config", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Google 연결 설정을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요.");
      const value = await response.json() as GoogleConfig | { configured: false };
      if (!active) return;
      setConfigChecked(true);
      if (value.configured) { setConfig(value); await prepareGoogle(); if (active) setGoogleReady(true); }
    }).catch(e => { if (active) { setConfigChecked(true); setError(e instanceof Error ? e.message : "Google 연결을 준비하지 못했습니다."); } });
    return () => { active = false; };
  }, [account?.authenticated]);
  const activeDocuments = all.filter(d => !d.sheet!.archivedAt).sort((a, b) => Number(b.sheet!.pinned) - Number(a.sheet!.pinned) || a.name.localeCompare(b.name));
  const document = selectedId ? all.find(d => d.id === selectedId) : activeDocuments[0];
  const tab = document?.sheet?.tabs.find(t => t.id === tabId) ?? document?.sheet?.tabs[0];
  const snapshot = document?.sheet?.snapshots.find(s => s.id === tab?.snapshotId);
  const visible = activeDocuments.filter(d => `${d.name} ${d.sheet!.folder}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const folders = [...new Set(visible.map(d => d.sheet!.folder || "내 시트"))];
  async function action(operation: () => Promise<void>) {
    if (working.current || saving || !ready) return;
    const generation = selectionGeneration.current;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (e) { if (mounted.current && generation === selectionGeneration.current) setError(e instanceof Error ? e.message : "처리하지 못했습니다. 기존 자료는 유지됩니다."); }
    finally { working.current = false; if (mounted.current) { setBusy(false); setLoadingTab(""); } }
  }
  function select(documentId: string, nextTabId: number | null) {
    selectionGeneration.current++;
    setSelectedId(documentId); setTabId(nextTabId); setNotice(""); setError("");
  }
  async function add() {
    if (!config) return;
    const generation = selectionGeneration.current;
    await connectGoogle(config);
    if (!mounted.current) return;
    const spreadsheetId = await chooseSheet(config);
    if (!spreadsheetId || !mounted.current) return;
    const metadata = await readSheetMetadata(config, spreadsheetId);
    if (!mounted.current) return;
    let selected = "";
    await mutate(d => {
      if (!mounted.current || d.activeSpace !== space || d.activeProjects[space] !== projectId) return d;
      const result = addSheet(d, space, projectId, spreadsheetId, metadata.name, metadata.tabs, now());
      selected = result.documentId; return result.data;
    });
    if (mounted.current && generation === selectionGeneration.current) { setSelectedId(selected); setTabId(null); setNotice("시트를 연결했습니다. 선택한 탭의 내용을 자동으로 불러옵니다."); }
  }
  async function refresh(range: string, interactive = true) {
    if (!config || !document?.sheet || !tab) return;
    parseSheetRange(range);
    const generation = selectionGeneration.current;
    if (!interactive && !hasGoogleSession(config)) return;
    setLoadingTab(`${document.id}:${tab.id}`);
    if (interactive) await connectGoogle(config);
    if (!mounted.current) return;
    const metadata = await readSheetMetadata(config, document.sheet.spreadsheetId);
    const latestTab = metadata.tabs.find(t => t.id === tab.id);
    if (!latestTab) throw new Error("원본에서 이 탭을 찾지 못했습니다. 다른 탭을 선택하거나 파일 선택기에서 다시 연결해주세요.");
    const loaded = await readSheetValues(config, document.sheet.spreadsheetId, latestTab, range);
    if (!mounted.current) return;
    await mutate(d => {
      const current = d.documents.find(row => row.id === document.id && row.space === space);
      if (!current?.sheet || current.sheet.archivedAt || !mounted.current || d.activeSpace !== space || d.activeProjects[space] !== projectId) return d;
      const updated = { ...current, name: metadata.name, sheet: { ...current.sheet, tabs: metadata.tabs.map(t => ({ ...current.sheet!.tabs.find(old => old.id === t.id), ...t })) } };
      const next = { ...d, documents: d.documents.map(row => row.id === current.id ? updated : row) };
      return saveSheetSnapshot(next, space, current.id, loaded);
    });
    if (mounted.current && generation === selectionGeneration.current) setNotice(`${loaded.tabTitle} · ${loaded.range}을 불러와 보관했습니다.`);
  }
  const disabled = busy || saving || !ready;
  const autoLoad = useEffectEvent(() => {
    if (disabled || working.current || !mounted.current || !googleReady || !config || !document?.sheet || document.sheet.archivedAt || !tab || snapshot || !hasGoogleSession(config)) return;
    const key = `${document.id}:${tab.id}`;
    if (autoAttempts.current.has(key)) return;
    // A failed read remains an explicit retry, rather than an effect retry loop.
    autoAttempts.current.add(key);
    void action(() => refresh(DEFAULT_RANGE, false));
  });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) autoLoad(); });
    return () => { active = false; };
  }, [disabled, googleReady, config, document?.id, document?.sheet?.archivedAt, tab?.id, snapshot?.id]);
  return <div className={studio.studio}>
    <WorkspaceControls />
    <div className={styles.heading}>
      <div><p className={studio.eyebrow}>WORKSPACE</p><h1>업무</h1><p>시트를 펼쳐 보고, 필요한 내용을 바로 물어보세요.</p></div>
      <nav><Link href="/library">자료실</Link><Link href="/tasks?view=records">기존 할 일</Link><Link href="/tasks?view=requests">수정 요청</Link></nav>
    </div>
    {error && <p role="alert" className={studio.formError}>{error}</p>}
    {notice && <p role="status" className={studio.notice}>{notice}</p>}
    <section className={styles.workspace} aria-label="시트 작업 공간" aria-busy={!ready || busy} data-questions-collapsed={questionsCollapsed}>
      <aside className={styles.tree} aria-label="시트 목록">
        <div className={styles.treeHeading}><strong>작업 중인 시트</strong><span>{activeDocuments.length}</span></div>
        <button className={studio.primaryButton} disabled={disabled || !googleReady} onClick={() => void action(add)}>＋ 시트 연결</button>
        <input aria-label="시트 찾기" placeholder="시트 찾기" value={search} onChange={e => setSearch(e.target.value)} />
        <div className={styles.treeItems}>{folders.map(folder => <details key={folder} open><summary>{folder}</summary>
          {visible.filter(d => (d.sheet!.folder || "내 시트") === folder).map(d => <div key={d.id} className={styles.treeFile}>
            <button aria-pressed={document?.id === d.id} onClick={() => select(d.id, null)}>{d.sheet!.pinned ? "★ " : "▤ "}{d.name}</button>
            {document?.id === d.id && <div className={styles.tabItems}>{d.sheet!.tabs.map(t => <button key={t.id} aria-pressed={tab?.id === t.id} onClick={() => select(d.id, t.id)}>└ {t.title}</button>)}</div>}
          </div>)}
        </details>)}{!visible.length && <p className={styles.muted}>{search ? "일치하는 시트가 없습니다." : "자주 보는 Google 시트를 연결해보세요."}</p>}</div>
        <Link href="/library" className={styles.archiveLink}>보관한 시트는 자료실에서 ↗</Link>
      </aside>
      <section className={styles.sheet} aria-label="선택한 시트">
        {!ready ? <div className={styles.empty} role="status"><h2>{storageError ? "업무를 불러오지 못했습니다" : "시트를 불러오고 있습니다"}</h2>{storageError && <button onClick={retryLoad}>다시 불러오기</button>}</div> : document?.sheet ? <>
          <div className={styles.documentHeading}><div><small>{document.sheet.archivedAt ? "자료실 · 보관한 내용" : "GOOGLE SHEETS"}</small><h2>{document.name}</h2></div>
            <a href={sheetUrl(document.sheet.spreadsheetId, tab?.id)} target="_blank" rel="noopener noreferrer">Google에서 수정 ↗</a>
          </div>
          <div className={styles.documentActions}>
            <button disabled={disabled} aria-pressed={document.sheet.pinned} onClick={() => void action(() => mutate(d => { const current = d.documents.find(row => row.id === document.id && row.space === space); return current?.sheet ? replaceSheet(d, current, { ...current.sheet, pinned: !current.sheet.pinned }) : d; }))}>{document.sheet.pinned ? "★ 고정됨" : "☆ 고정"}</button>
            <FolderField key={`${document.id}:${document.sheet.folder}`} value={document.sheet.folder} disabled={disabled} save={folder => action(() => mutate(d => { const current = d.documents.find(row => row.id === document.id && row.space === space); return current?.sheet ? replaceSheet(d, current, { ...current.sheet, folder }) : d; }))} />
            <button disabled={disabled || !document.sheet.archivedAt && !document.sheet.snapshots.length} onClick={() => void action(async () => { setSelectedId(document.id); await mutate(d => archiveSheet(d, space, document.id, !document.sheet!.archivedAt, now())); setNotice(document.sheet!.archivedAt ? "업무 시트 목록으로 되돌렸습니다." : "불러온 범위와 문답을 자료실에 보관했습니다. 원본 파일은 그대로입니다."); })}>{document.sheet.archivedAt ? "업무로 복귀" : "자료실로 보내기"}</button>
          </div>
          {tab && <SheetTable key={`${document.id}:${tab.id}:${snapshot?.id ?? "empty"}`} snapshot={snapshot} tab={tab} checkedAt={tab.checkedAt} archived={!!document.sheet.archivedAt} refresh={range => action(() => refresh(range))} disabled={disabled || !googleReady} loading={loadingTab === `${document.id}:${tab.id}`} preferenceKey={`${preferenceScope}:${document.id}:${tab.id}:sizes`} />}
          {!config && <GoogleSetup authenticated={!!account?.authenticated} checked={configChecked} compact />}
        </> : <div className={styles.empty}>
          <span className={styles.sheetMark}>▤</span><h2>{initialDocument ? "현재 영역에서 이 시트를 찾을 수 없습니다" : "업무의 중심에 시트를 두세요"}</h2>
          <p>왼쪽에 파일과 탭을 정리하고, 가운데에서 내용을 확인하세요.<br />오른쪽 AI 문답은 선택한 범위를 함께 읽습니다.</p>
          {!config && <GoogleSetup authenticated={!!account?.authenticated} checked={configChecked} />}
          {googleReady && <button className={studio.primaryButton} disabled={disabled} onClick={() => void action(add)}>Google 시트 선택</button>}
        </div>}
      </section>
      <DocumentQuestions key={`${document?.id ?? "empty"}:${snapshot?.id ?? "empty"}`} document={document} snapshot={snapshot} disabled={disabled} action={action} refresh={retryLoad} collapsed={questionsCollapsed} toggle={() => saveQuestionVisibility(questionsCollapsed ? "expanded" : "collapsed")} />
    </section>
    <section className={styles.lower} aria-label="다음 작업 공간"><div><small>NEXT SPACE</small><h2>다음 작업을 위한 공간</h2><p>필요한 기능을 이어 붙일 수 있도록 비워두었습니다.</p></div><span aria-hidden="true">＋</span></section>
  </div>;
}
function FolderField({ value, disabled, save }: { value: string; disabled: boolean; save: (value: string) => Promise<void> }) {
  const [folder, setFolder] = useState(value);
  return <form onSubmit={e => { e.preventDefault(); void save(folder.trim()); }}><input aria-label="시트 폴더" placeholder="폴더 이름" maxLength={100} value={folder} onChange={e => setFolder(e.target.value)} /><button disabled={disabled || value === folder.trim()}>이동</button></form>;
}
function GoogleSetup({ authenticated, checked, compact = false }: { authenticated: boolean; checked: boolean; compact?: boolean }) {
  return <details className={styles.setup} open={!compact}>
    <summary>Google 최초 연결 안내</summary>
    <p>{!authenticated ? "Google 파일 연결과 CLI 문답에는 자비스의 서버 기기 연결이 필요합니다. 보관한 내용은 로컬에서도 볼 수 있습니다." : checked ? "Google 연결 설정을 먼저 준비해주세요." : "Google 연결 설정을 확인하고 있습니다."}</p>
    <ol>
      <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud 프로젝트</a>를 만들고 <b>Google Sheets API · Google Picker API</b>를 사용 설정합니다.</li>
      <li>Google Auth Platform에서 앱 이름·이메일을 입력하고 본인을 테스트 사용자로 등록합니다.</li>
      <li>웹 애플리케이션 OAuth 클라이언트를 만들고 승인된 JavaScript 원본에 <code>https://jarvis-zeta-three-77.vercel.app</code>을 등록합니다. 리디렉션 URI는 사용하지 않습니다.</li>
      <li>브라우저 API 키를 만들고 위 사이트의 <code>{"/*"}</code> 주소로 HTTP 리퍼러를 제한합니다. API 제한은 Google Picker API로 지정합니다.</li>
      <li>자비스 배포 설정에 <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_BROWSER_API_KEY</code>, <code>GOOGLE_PROJECT_NUMBER</code>를 등록합니다. 클라이언트 비밀번호는 사용하지 않습니다.</li>
    </ol>
    <p>설정 후 ‘시트 연결’에서 허용한 파일만 선택합니다. Google 인증 토큰은 이 브라우저를 닫으면 사라집니다.</p>
  </details>;
}
function SheetTable({ snapshot, tab, checkedAt, archived, refresh, disabled, loading, preferenceKey }: { snapshot?: SheetSnapshot; tab: SheetTab; checkedAt?: string; archived: boolean; refresh: (range: string) => Promise<void>; disabled: boolean; loading: boolean; preferenceKey: string }) {
  const [range, setRange] = useState(snapshot?.range ?? DEFAULT_RANGE);
  return <>
    <form className={styles.rangeBar} onSubmit={e => { e.preventDefault(); void refresh(range); }}><strong>{tab.title}</strong><label>범위 <input aria-label="불러올 범위" value={range} maxLength={40} disabled={archived || loading} onChange={e => setRange(e.target.value)} /></label>{!archived && <button disabled={disabled}>{loading ? "불러오는 중…" : snapshot ? "다시 불러오기" : "Google 연결·불러오기"}</button>}</form>
    <p className={styles.readTime}>{snapshot ? `${snapshot.range} · ${time(checkedAt ?? snapshot.capturedAt)}에 확인 · 불러온 범위만 보관` : "연결 후 선택한 탭을 자동으로 읽습니다. 기본 A1:T200 · 최대 500행·50열, 총 10,000셀"}</p>
    {snapshot?.values.length ? <SheetGrid snapshot={snapshot} preferenceKey={preferenceKey} /> : <div className={styles.tableScroll} tabIndex={0} aria-label={`${tab.title} 표`}><div className={styles.tableEmpty} role="status">{loading ? "선택한 탭을 불러오고 있습니다…" : snapshot ? "이 범위에는 값이 없습니다." : archived ? "이 탭은 보관한 내용이 없습니다." : "Google에 한 번 연결하면 선택하는 탭을 자동으로 불러옵니다."}</div></div>}
    {archived && <p className={styles.readTime}>보관 당시의 내용입니다. 최신 원본을 읽으려면 ‘업무로 복귀’ 후 다시 불러오세요.</p>}
  </>;
}
function DocumentQuestions({ document, snapshot, disabled, action, refresh, collapsed, toggle }: { document?: Document; snapshot?: SheetSnapshot; disabled: boolean; action: (operation: () => Promise<void>) => Promise<void>; refresh: () => void; collapsed: boolean; toggle: () => void }) {
  const { mutate, account } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const sheet = document?.sheet, questions = sheet?.questions ?? [];
  const pending = questions.some(q => ["queued", "running"].includes(q.status));
  const online = !!sheet?.runnerSeenAt && clock - Date.parse(sheet.runnerSeenAt) < 3 * 60_000;
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!document || !snapshot || !question.trim() || !account?.authenticated) return;
    const questionId = id();
    await action(async () => { await mutate(d => enqueueDocumentQuestion(d, document.space, document.id, snapshot.id, question, now(), questionId)); setQuestion(""); });
  }
  function update(q: DocumentQuestion, change: "cancel" | "retry") { if (document) void action(() => mutate(d => changeDocumentQuestion(d, document.space, document.id, q.id, change, now()))); }
  return <aside className={styles.questions} aria-label="문서 AI 문답" data-collapsed={collapsed}>
    <div className={styles.questionHeading}><div hidden={collapsed}><small>ASK THIS SHEET</small><h2>문서에 물어보기</h2></div><div className={styles.questionButtons}>
      {!collapsed && <button onClick={refresh} aria-label="문답 상태 새로고침">↻</button>}
      <button onClick={toggle} aria-label={`문서에 물어보기 ${collapsed ? "열기" : "접기"}`} title={`문서에 물어보기 ${collapsed ? "열기" : "접기"}`} aria-expanded={!collapsed} aria-controls="sheet-question-content">{collapsed ? "‹" : "›"}<span className={styles.collapsedLabel} hidden={!collapsed}>문답 열기</span></button>
    </div></div>
    <div id="sheet-question-content" className={styles.questionBody} hidden={collapsed}>
    <p className={styles.runner} data-online={online}>{online ? "문답 실행기 연결됨" : "맥미니 문답 실행기 대기"}</p>
    {!online && <p className={styles.hint}>문답은 실행기 2.2.0 이상이 필요합니다. <Link href="/settings#cli-runner">맥미니 연결·업데이트</Link>에서 이 시트의 프로젝트를 포함해주세요.</p>}
    <div className={styles.conversation} aria-live="polite">
      {!questions.length && <div className={styles.questionEmpty}><span>✦</span><p>“이 표에서 마감이 가장 빠른 건?”<br />“이 항목은 무슨 뜻이야?”</p><small>선택한 탭의 불러온 내용으로<br />짧게 묻고 답하세요.</small></div>}
      {questions.length > 5 && <button onClick={() => setShowAll(v => !v)}>{showAll ? "최근 문답만" : `이전 문답 ${questions.length - 5}개 보기`}</button>}
      {(showAll ? questions : questions.slice(-5)).map(q => {
        const source = sheet!.snapshots.find(s => s.id === q.snapshotId)!;
        return <article className={styles.answer} key={q.id}><p className={styles.prompt}>{q.question}</p><small>{questionStatus[q.status]}</small>
          {q.answer && <><p>{q.answer.reply}</p>{q.answer.limitation && <p className={styles.hint}>{q.answer.limitation}</p>}
            <div className={styles.citations}>{q.answer.rows.map(row => <a key={row} href={sheetUrl(sheet!.spreadsheetId, source.tabId, `${parseSheetRange(source.range).range.match(/^[A-Z]+/)![0]}${row}`)} target="_blank" rel="noopener noreferrer">{row}행 ↗</a>)}</div></>}
          <small>{q.documentName} · {source.tabTitle} · {source.range}<br />{time(q.readAt)}에 읽은 내용 · 현재 원본은 다를 수 있습니다.</small>
          {q.error && <p className={styles.hint}>{errors[q.error] ?? "답변을 완료하지 못했습니다. 실행기를 확인하고 다시 시도해주세요."}</p>}
          {["queued", "running"].includes(q.status) && <button disabled={disabled} onClick={() => update(q, "cancel")}>질문 취소</button>}
          {["failed", "interrupted"].includes(q.status) && <button disabled={disabled || pending || !account?.authenticated} onClick={() => update(q, "retry")}>같은 내용으로 재시도</button>}
        </article>;
      })}
    </div>
    <form className={styles.composer} onSubmit={e => void send(e)}>
      <label htmlFor="sheet-question">{snapshot ? `${snapshot.tabTitle} · ${snapshot.range}에 질문` : "내용을 불러온 뒤 질문할 수 있습니다"}</label>
      <textarea id="sheet-question" maxLength={2000} rows={3} value={question} disabled={!snapshot || !account?.authenticated} onChange={e => setQuestion(e.target.value)} placeholder="문서에 대해 궁금한 내용을 적어주세요" />
      <button className={studio.primaryButton} disabled={disabled || pending || !snapshot || !question.trim() || !account?.authenticated}>질문 보내기 ↗</button>
      <small>선택한 범위와 질문을 맥미니의 Codex 구독 CLI로 보냅니다. 구독 사용 한도가 적용됩니다.</small>
    </form>
    </div>
  </aside>;
}
