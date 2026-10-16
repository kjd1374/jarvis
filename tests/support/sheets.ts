import { emptyWorkspace } from "../../src/lib/workspace/types";
import { addSheet, saveSheetSnapshot } from "../../src/lib/sheets/documents";
export const stamp = "2026-10-17T00:00:00.000Z";
export const snapshotId = "11111111-1111-4111-8111-111111111111";
export const questionId = "22222222-2222-4222-8222-222222222222";
export function sheetWorkspace() {
  const data = emptyWorkspace();
  data.projects.push({ id: "sheet-project", space: "company", name: "합성 시트 프로젝트", description: "합성 검증", createdAt: stamp });
  data.activeProjects.company = "sheet-project";
  const added = addSheet(data, "company", "sheet-project", "synthetic_sheet_123", "합성 업무 시트", [{ id: 7, title: "일정" }, { id: 8, title: "다음 탭" }], stamp);
  return saveSheetSnapshot(added.data, "company", added.documentId, { id: snapshotId, tabId: 7, tabTitle: "일정", range: "B10:D20", capturedAt: stamp,
    values: [["항목", "마감", "상태"], ["합성 일정", "10월 20일", "진행"], ["합성 다음 일", "10월 22일", "예정"]] });
}
