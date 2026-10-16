export type SheetSnapshot = {
  id: string;
  tabId: number;
  tabTitle: string;
  range: string;
  values: string[][];
  capturedAt: string;
};
export type SheetTab = { id: number; title: string; snapshotId?: string; checkedAt?: string };
export type DocumentAnswer = { reply: string; rows: number[]; limitation: string };
export type DocumentQuestion = {
  id: string;
  snapshotId: string;
  question: string;
  documentName: string;
  readAt: string;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
  attempt: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseUntil?: string;
  error?: string;
  answer?: DocumentAnswer;
};
export type SheetDocument = {
  version: 1;
  spreadsheetId: string;
  folder: string;
  pinned: boolean;
  archivedAt: string | null;
  tabs: SheetTab[];
  snapshots: SheetSnapshot[];
  questions: DocumentQuestion[];
  runnerSeenAt?: string;
};
