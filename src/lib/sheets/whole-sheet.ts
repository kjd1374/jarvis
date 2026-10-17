import { id } from "../workspace/types";
import { columnName, validateSnapshot } from "./documents";
import type { SheetSnapshot, SheetTab, WholeSheetRead } from "./types";

export type WholeSheetValues = { snapshots: SheetSnapshot[]; wholeRead: WholeSheetRead };
export function splitWholeSheet(tab: SheetTab, raw: unknown, capturedAt: string): WholeSheetValues {
  const tooLarge = "탭 전체 읽기 한도(50만 셀·150만 자 또는 200개 표시 구간)를 넘었습니다. 기존 내용은 유지됩니다. Google에서 원본을 열어주세요.";
  if (!Array.isArray(raw) || raw.length > 100_000 || raw.some(row => !Array.isArray(row) || row.length > 18_278 || row.some(cell => typeof cell !== "string" || cell.length > 10_000)))
    throw new Error("탭의 값이 지원 한도를 넘거나 올바르지 않습니다. 기존 내용은 유지됩니다.");
  const values = raw as string[][];
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0), rowCount = columnCount ? values.length : 0;
  if (rowCount * columnCount > 500_000 || JSON.stringify(values).length > 1_500_000) throw new Error(tooLarge);
  const snapshots: SheetSnapshot[] = [];
  function partition(row: number, endRow: number, col: number, endCol: number) {
    const cells = values.slice(row, endRow).map(line => line.slice(col, endCol));
    if (JSON.stringify(cells).length > 40_000) {
      if (endRow - row > 1) { const mid = Math.floor((row + endRow) / 2); partition(row, mid, col, endCol); partition(mid, endRow, col, endCol); }
      else { const mid = Math.floor((col + endCol) / 2); partition(row, endRow, col, mid); partition(row, endRow, mid, endCol); }
      return;
    }
    if (snapshots.length >= 200) throw new Error(tooLarge);
    const snapshot = { id: id(), tabId: tab.id, tabTitle: tab.title, range: `${columnName(col + 1)}${row + 1}:${columnName(endCol)}${endRow}`, capturedAt, values: cells };
    validateSnapshot(snapshot); snapshots.push(snapshot);
  }
  for (let row = 0; row < rowCount; row += 200)
    for (let col = 0; col < columnCount; col += 50) partition(row, Math.min(rowCount, row + 200), col, Math.min(columnCount, col + 50));
  if (!snapshots.length) snapshots.push({ id: id(), tabId: tab.id, tabTitle: tab.title, range: "A1:A1", capturedAt, values: [] });
  return { snapshots, wholeRead: { snapshotIds: snapshots.map(s => s.id), rowCount, columnCount, capturedAt } };
}
