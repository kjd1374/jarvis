import { emptyWorkspace, type WorkspaceData } from "./types";

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("jarvis-workspace", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("workspace");
        request.result.createObjectStore("files");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        database = undefined;
        reject(new Error("브라우저 저장 공간을 열 수 없습니다."));
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error("다른 Jarvis 탭을 닫고 다시 열어주세요."));
      };
    });
  return database;
}

function decode(value: unknown): WorkspaceData {
  if (value === undefined) return emptyWorkspace();
  const data = value as WorkspaceData;
  if (
    data.version !== 1 ||
    !Array.isArray(data.messages) ||
    !Array.isArray(data.documents) ||
    !Array.isArray(data.contextRevisions)
  )
    throw new Error(
      "저장된 데이터 형식을 확인할 수 없습니다. 기존 데이터는 유지됩니다.",
    );
  return data;
}

export async function readWorkspace(): Promise<WorkspaceData> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readonly");
    const request = tx.objectStore("workspace").get("current");
    request.onsuccess = () => {
      try {
        resolve(decode(request.result));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () =>
      reject(new Error("저장된 업무 맥락을 읽을 수 없습니다."));
  });
}

// Read and update in one transaction, including blobs, so tabs cannot overwrite each other's changes.
export async function commitWorkspace(
  transform: (data: WorkspaceData) => WorkspaceData,
  files: { id: string; blob: Blob }[] = [],
): Promise<WorkspaceData> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["workspace", "files"], "readwrite");
    let result: WorkspaceData;
    let failure: unknown;
    const store = tx.objectStore("workspace");
    const request = store.get("current");
    request.onsuccess = () => {
      try {
        result = transform(decode(request.result));
        store.put(result, "current");
        for (const file of files)
          tx.objectStore("files").put(file.blob, file.id);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        failure ??
          new Error("저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요."),
      );
    tx.onerror = () => {
      /* onabort reports the failure; never display a successful save before commit. */
    };
  });
}

export async function readFile(fileId: string): Promise<Blob> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("files", "readonly")
      .objectStore("files")
      .get(fileId);
    request.onsuccess = () =>
      request.result instanceof Blob
        ? resolve(request.result)
        : reject(new Error("파일 원본을 찾을 수 없습니다."));
    request.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
  });
}
