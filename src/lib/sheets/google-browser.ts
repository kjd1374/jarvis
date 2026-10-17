import { id, now } from "../workspace/types";
import { parseSheetRange, validSpreadsheetId, validateSnapshot, SHEET_MIME } from "./documents";
import type { SheetSnapshot, SheetTab } from "./types";

export type GoogleConfig = { configured: true; clientId: string; apiKey: string; projectNumber: string };
type TokenResult = { access_token?: string; expires_in?: number; error?: string; scope?: string };
type PickerResult = { action: string; docs?: { id: string; mimeType?: string }[] };
type PickerView = { setMimeTypes(value: string): PickerView; setMode(mode: string): PickerView };
type PickerBuilder = {
  addView(view: PickerView): PickerBuilder; setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder; setCallback(cb: (data: PickerResult) => void): PickerBuilder;
  setLocale(locale: string): PickerBuilder; setTitle(title: string): PickerBuilder;
  setSize(width: number, height: number): PickerBuilder;
  build(): { setVisible(value: boolean): void; dispose(): void };
};
type GoogleWindow = Window & {
  google?: {
    accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; callback: (result: TokenResult) => void; error_callback: () => void }): { requestAccessToken(config: { prompt: string }): void } } };
    picker: { DocsView: new (id: string) => PickerView; ViewId: { SPREADSHEETS: string }; DocsViewMode: { LIST: string }; PickerBuilder: new () => PickerBuilder };
  };
  gapi?: { load(name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void };
};
const scripts = new Map<string, Promise<void>>();
// Never persist OAuth credentials in workspace records, browser storage or the runner.
let token: { value: string; until: number; clientId: string } | undefined;
let session = 0;
export function forgetGoogleToken() { token = undefined; session++; }
export function hasGoogleSession(config: GoogleConfig) { return !!token && token.clientId === config.clientId && token.until > Date.now(); }
function script(src: string) {
  if (!scripts.has(src)) scripts.set(src, new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    const fail = () => { element.remove(); scripts.delete(src); reject(new Error("Google 연결 도구를 불러오지 못했습니다. 네트워크를 확인해주세요.")); };
    const timer = setTimeout(fail, 20_000);
    element.src = src; element.async = true; element.referrerPolicy = "strict-origin-when-cross-origin";
    element.onload = () => { clearTimeout(timer); resolve(); };
    element.onerror = () => { clearTimeout(timer); fail(); };
    document.head.append(element);
  }));
  return scripts.get(src)!;
}
export async function prepareGoogle() {
  await Promise.all([script("https://accounts.google.com/gsi/client"), script("https://apis.google.com/js/api.js")]);
  const gapi = (window as GoogleWindow).gapi;
  if (!gapi) throw new Error("Google 연결 도구가 준비되지 않았습니다.");
  await new Promise<void>((resolve, reject) => gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("파일 선택기를 열지 못했습니다.")), timeout: 15_000, ontimeout: () => reject(new Error("파일 선택기를 불러오는 시간이 초과되었습니다.")) }));
}
export function connectGoogle(config: GoogleConfig): Promise<void> {
  const oauth2 = (window as GoogleWindow).google?.accounts?.oauth2;
  if (!oauth2) return Promise.reject(new Error("Google 연결 준비 후 다시 눌러주세요."));
  if (token && token.clientId === config.clientId && token.until > Date.now()) return Promise.resolve();
  const currentSession = session;
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({ client_id: config.clientId, scope: "https://www.googleapis.com/auth/drive.file",
      callback: result => {
        if (session !== currentSession) { reject(new Error("작업 공간이 변경되었습니다. 다시 연결해주세요.")); return; }
        if (result.error || !result.access_token || !result.scope?.split(" ").includes("https://www.googleapis.com/auth/drive.file")) { reject(new Error("선택한 Google 파일을 읽을 수 있도록 연결을 허용해주세요.")); return; }
        token = { value: result.access_token, clientId: config.clientId, until: Date.now() + Math.max(0, Number(result.expires_in ?? 0) - 60) * 1000 }; resolve();
      }, error_callback: () => reject(new Error("Google 연결 창이 닫혔거나 열리지 않았습니다. 다시 연결해주세요.")) });
    client.requestAccessToken({ prompt: "" });
  });
}
function accessToken(config: GoogleConfig) {
  if (!token || token.clientId !== config.clientId || token.until <= Date.now()) throw new Error("Google에 다시 연결한 뒤 불러와주세요. 보관한 내용은 그대로 남아 있습니다.");
  return token.value;
}
export function chooseSheet(config: GoogleConfig): Promise<string | null> {
  const picker = (window as GoogleWindow).google?.picker, access = accessToken(config);
  if (!picker) return Promise.reject(new Error("Google 파일 선택기를 준비해주세요."));
  return new Promise((resolve, reject) => {
    // drive.file does not grant thumbnail access. Google's recommended LIST mode
    // also leaves more room for filenames than the default thumbnail cards.
    const builder = new picker.PickerBuilder().addView(new picker.DocsView(picker.ViewId.SPREADSHEETS).setMimeTypes(SHEET_MIME).setMode(picker.DocsViewMode.LIST))
      .setLocale("ko").setTitle("연결할 Google 시트 선택")
      .setOAuthToken(access).setDeveloperKey(config.apiKey).setAppId(config.projectNumber).setOrigin(window.location.origin)
      .setCallback(result => {
        if (result.action === "cancel") { dialog.dispose(); resolve(null); }
        if (result.action === "picked") {
          dialog.dispose();
          const doc = result.docs?.[0];
          if (!doc || !validSpreadsheetId(doc.id) || doc.mimeType && doc.mimeType !== SHEET_MIME) reject(new Error("Google 스프레드시트를 선택해주세요."));
          else resolve(doc.id);
        }
      });
    // setSize supports 566×350–1051×650. Let the SDK handle smaller screens.
    if (window.innerWidth >= 598 && window.innerHeight >= 382) {
      builder.setSize(Math.min(900, window.innerWidth - 32), Math.min(560, window.innerHeight - 32));
    }
    const dialog = builder.build();
    dialog.setVisible(true);
  });
}
async function googleGet(config: GoogleConfig, path: string) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { Authorization: `Bearer ${accessToken(config)}` }, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    if (response.status === 401) { token = undefined; throw new Error("Google 연결 시간이 만료되었습니다. 다시 연결해주세요."); }
    if ([403, 404].includes(response.status)) throw new Error("파일 권한 또는 Google Sheets API 설정을 확인해주세요. 파일 선택기로 다시 선택할 수 있습니다.");
    throw new Error("시트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요. 이전 내용은 유지됩니다.");
  }
  // Bound the response before parsing; even a small cell range can contain very large text.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("시트 응답이 없습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 500_000) { await reader.cancel(); throw new Error("내용이 너무 큽니다. 불러올 범위를 줄여주세요."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
export async function readSheetMetadata(config: GoogleConfig, spreadsheetId: string): Promise<{ name: string; tabs: SheetTab[] }> {
  if (!validSpreadsheetId(spreadsheetId)) throw new Error("시트 주소를 확인해주세요.");
  const raw = await googleGet(config, `${spreadsheetId}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType))`) as { spreadsheetId?: string; properties?: { title?: string }; sheets?: { properties: { sheetId: number; title: string; sheetType?: string } }[] };
  if (raw.spreadsheetId !== spreadsheetId || typeof raw.properties?.title !== "string" || !Array.isArray(raw.sheets)) throw new Error("시트 정보를 확인하지 못했습니다.");
  const tabs = raw.sheets.filter(s => s.properties.sheetType === "GRID" || !s.properties.sheetType).map(s => ({ id: s.properties.sheetId, title: s.properties.title }));
  if (!tabs.length || tabs.length > 100 || tabs.some(t => !Number.isSafeInteger(t.id) || t.id < 0 || typeof t.title !== "string" || t.title.length > 200)) throw new Error("지원하는 시트 탭을 확인하지 못했습니다.");
  return { name: raw.properties.title.slice(0, 500), tabs };
}
export async function readSheetValues(config: GoogleConfig, spreadsheetId: string, tab: SheetTab, range: string): Promise<SheetSnapshot> {
  if (!validSpreadsheetId(spreadsheetId)) throw new Error("시트 주소를 확인해주세요.");
  const selection = parseSheetRange(range).range;
  const a1 = `'${tab.title.replaceAll("'", "''")}'!${selection}`;
  const raw = await googleGet(config, `${spreadsheetId}/values/${encodeURIComponent(a1)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`) as { values?: unknown };
  const snapshot = { id: id(), tabId: tab.id, tabTitle: tab.title, range: selection, capturedAt: now(), values: raw.values ?? [] };
  validateSnapshot(snapshot);
  return snapshot;
}
