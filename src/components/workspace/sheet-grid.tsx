"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { columnName, parseSheetRange } from "@/lib/sheets/documents";
import type { SheetSnapshot } from "@/lib/sheets/types";
import { useSheetViewPreference } from "./sheet-view-preference";
import styles from "./sheet-workspace.module.css";

type Axis = "columns" | "rows";
type Sizes = Record<Axis, Record<string, number>>;
const limits = { columns: { min: 60, max: 800, initial: 180 }, rows: { min: 28, max: 500, initial: 40 } };
const emptySizes = (): Sizes => ({ columns: {}, rows: {} });
function readSizes(raw: string): Sizes {
  const result = emptySizes();
  try {
    if (raw.length > 30_000) return result;
    const value = JSON.parse(raw);
    for (const axis of ["columns", "rows"] as const) {
      if (!value?.[axis] || typeof value[axis] !== "object" || Array.isArray(value[axis])) continue;
      for (const [index, size] of Object.entries(value[axis]).slice(-500)) {
        if (/^[1-9][0-9]{0,6}$/.test(index) && typeof size === "number" && Number.isInteger(size) && size >= limits[axis].min && size <= limits[axis].max) result[axis][index] = size;
      }
    }
  } catch { /* An old or unavailable preference cannot hide the saved table. */ }
  return result;
}
const clamp = (axis: Axis, value: number) => Math.max(limits[axis].min, Math.min(limits[axis].max, Math.round(value)));
function resize(sizes: Sizes, axis: Axis, index: number, value: number) {
  const values: Record<string, number> = { ...sizes[axis], [index]: clamp(axis, value) };
  if (Object.keys(values).length > 500) delete values[Object.keys(values).find(key => key !== String(index))!];
  return { ...sizes, [axis]: values };
}

export function SheetGrid({ snapshot, preferenceKey, fillRange = false }: { snapshot: SheetSnapshot; preferenceKey: string; fillRange?: boolean }) {
  const [raw, save] = useSheetViewPreference(preferenceKey);
  const stored = useMemo(() => readSizes(raw), [raw]);
  const [draft, setDraft] = useState<Sizes | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const drag = useRef<{ pointerId: number; axis: Axis; index: number; start: number; initial: number; base: Sizes; latest: Sizes } | null>(null);
  const sizes = draft ?? stored, selection = parseSheetRange(snapshot.range);
  const columns = fillRange ? selection.endColumn - selection.startColumn + 1 : Math.max(1, ...snapshot.values.map(row => row.length));
  const width = (index: number) => sizes.columns[index] ?? limits.columns.initial;
  const height = (index: number) => sizes.rows[index] ?? limits.rows.initial;
  const commit = (next: Sizes) => { setStorageFailed(!save(JSON.stringify(readSizes(JSON.stringify(next))))); };
  function change(axis: Axis, index: number, value?: number) {
    const next = { ...stored, [axis]: { ...stored[axis] } };
    if (value === undefined) { delete next[axis][index]; commit(next); }
    else commit(resize(stored, axis, index, value));
  }
  function start(event: PointerEvent<HTMLButtonElement>, axis: Axis, index: number) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, axis, index, start: axis === "columns" ? event.clientX : event.clientY, initial: stored[axis][index] ?? limits[axis].initial, base: stored, latest: stored };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const position = current.axis === "columns" ? event.clientX : event.clientY;
    current.latest = resize(current.base, current.axis, current.index, current.initial + position - current.start);
    setDraft(current.latest);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const next = drag.current.latest; drag.current = null;
    if (!cancelled) commit(next);
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, axis: Axis, index: number) {
    const smaller = axis === "columns" ? "ArrowLeft" : "ArrowUp", larger = axis === "columns" ? "ArrowRight" : "ArrowDown";
    if (![smaller, larger, "Home"].includes(event.key)) return;
    event.preventDefault();
    change(axis, index, event.key === "Home" ? undefined : (stored[axis][index] ?? limits[axis].initial) + (event.key === larger ? 1 : -1) * (axis === "columns" ? 10 : 4));
  }
  function handle(axis: Axis, index: number) {
    const label = axis === "columns" ? `${columnName(index)}열 너비` : `${index}행 높이`;
    return <button type="button" role="separator" aria-label={label} aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
      aria-valuemin={limits[axis].min} aria-valuemax={limits[axis].max} aria-valuenow={sizes[axis][index] ?? limits[axis].initial}
      title={`${label} 조절 · 방향키 또는 드래그 · 두 번 클릭하면 초기화`}
      className={axis === "columns" ? styles.columnResize : styles.rowResize}
      onPointerDown={e => start(e, axis, index)} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)}
      onDoubleClick={() => change(axis, index)} onKeyDown={e => keyboard(e, axis, index)} />;
  }
  return <>
    <div className={styles.tableTools}><span>{storageFailed ? "크기를 저장하지 못해 이 화면에서만 유지합니다." : "열·행 경계를 끌어 크기 조절 · 이 브라우저에 기억"}</span><button type="button" onClick={() => commit(emptySizes())}>크기 초기화</button></div>
    <div className={styles.tableScroll} tabIndex={0} aria-label={`${snapshot.tabTitle} 표`}>
      <table style={{ width: 48 + Array.from({ length: columns }, (_, i) => width(selection.startColumn + i)).reduce((a, b) => a + b, 0) }}>
        <colgroup><col style={{ width: 48 }} />{Array.from({ length: columns }, (_, i) => <col key={i} style={{ width: width(selection.startColumn + i) }} />)}</colgroup>
        <thead><tr><th aria-label="행 번호" />{Array.from({ length: columns }, (_, i) => { const index = selection.startColumn + i; return <th key={index} scope="col" aria-label={columnName(index)}>{columnName(index)}{handle("columns", index)}</th>; })}</tr></thead>
        <tbody>{snapshot.values.map((row, i) => { const index = selection.startRow + i; return <tr key={index}>
          <th scope="row" aria-label={`${index}행`}><div className={styles.rowNumber} style={{ height: height(index) - 1 }}>{index}</div>{handle("rows", index)}</th>
          {Array.from({ length: columns }, (_, col) => <td key={col} title={row[col] ?? ""}><div className={styles.cellValue} style={{ height: height(index) - 1 }}>{row[col] ?? ""}</div></td>)}
        </tr>; })}</tbody>
      </table>
    </div>
  </>;
}
