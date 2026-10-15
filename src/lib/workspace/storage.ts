import { type WorkspaceData } from "./types";
import { normalizeWorkspace } from "./validation";

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
  return normalizeWorkspace(value);
}

const checkpointKey = "last-confirmed";
export type StorageRecovery = {
  current: "valid" | "missing" | "unreadable";
  checkpoint: { data: WorkspaceData; savedAt: string } | null;
};

// A missing snapshot is only a new workspace when no confirmed copy exists.
// Never convert a damaged/missing saved snapshot into an empty writable workspace.
function readCurrent(
  store: IDBObjectStore,
  accept: (data: WorkspaceData) => void,
  fail: (error: unknown) => void,
) {
  const current = store.get("current");
  const checkpoint = store.get(checkpointKey);
  let remaining = 2;
  function complete() {
    if (--remaining) return;
    try {
      if (current.result === undefined && checkpoint.result !== undefined)
        throw new Error(
          "저장된 기록을 찾지 못했습니다. 설정에서 마지막 정상 저장본을 확인해주세요.",
        );
      accept(decode(current.result));
    } catch (error) {
      fail(error);
    }
  }
  current.onsuccess = checkpoint.onsuccess = complete;
  current.onerror = checkpoint.onerror = () =>
    fail(new Error("저장된 업무 맥락을 읽을 수 없습니다."));
}

export async function readWorkspace(): Promise<WorkspaceData> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readonly");
    let result: WorkspaceData;
    readCurrent(
      tx.objectStore("workspace"),
      (value) => {
        result = value;
      },
      reject,
    );
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(new Error("저장된 업무 맥락을 읽을 수 없습니다."));
  });
}

// Read and update in one transaction, including blobs, so tabs cannot overwrite each other's changes.
export async function commitWorkspace(
  transform: (data: WorkspaceData) => WorkspaceData,
  files: { id: string; blob: Blob; preventOverwrite?: boolean }[] = [],
): Promise<WorkspaceData> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["workspace", "files"], "readwrite", {
      durability: "strict",
    });
    let result: WorkspaceData;
    let failure: unknown;
    const store = tx.objectStore("workspace");
    readCurrent(
      store,
      (current) => {
        try {
          result = normalizeWorkspace(transform(current));
          store.put(result, "current");
          store.put(
            { data: result, savedAt: new Date().toISOString() },
            checkpointKey,
          );
          for (const file of files) {
            const record = result.documents.find(
              (d) => d.id === file.id && !d.sourceUrl,
            );
            if (!record || record.size !== file.blob.size)
              throw new Error(
                "파일 원본과 저장 정보가 일치하지 않습니다. 기존 기록은 유지됩니다.",
              );
            const filesStore = tx.objectStore("files");
            if (file.preventOverwrite) filesStore.add(file.blob, file.id);
            else filesStore.put(file.blob, file.id);
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      },
      (error) => {
        failure = error;
        tx.abort();
      },
    );
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

export async function inspectStorageRecovery(): Promise<StorageRecovery> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readonly");
    const store = tx.objectStore("workspace");
    const current = store.get("current");
    const checkpoint = store.get(checkpointKey);
    tx.oncomplete = () => {
      try {
        let status: StorageRecovery["current"] = "missing";
        if (current.result !== undefined) {
          try {
            decode(current.result);
            status = "valid";
          } catch {
            status = "unreadable";
          }
        }
        const copy = checkpoint.result;
        if (
          copy &&
          (copy.data === undefined ||
            typeof copy.savedAt !== "string" ||
            !Number.isFinite(Date.parse(copy.savedAt)))
        )
          throw new Error("정상 저장본의 저장 시각을 확인할 수 없습니다.");
        resolve({
          current: status,
          checkpoint: copy
            ? { data: decode(copy.data), savedAt: copy.savedAt }
            : null,
        });
      } catch (error) {
        reject(error);
      }
    };
    tx.onabort = () =>
      reject(
        new Error("저장 상태를 확인하지 못했습니다. 기존 기록은 유지됩니다."),
      );
  });
}

// Explicit user confirmation is required by the UI. Recheck inside the write
// transaction so another tab's successful save can never be overwritten.
export async function restoreStorageRecovery(): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite", {
      durability: "strict",
    });
    const store = tx.objectStore("workspace");
    const current = store.get("current");
    const checkpoint = store.get(checkpointKey);
    let remaining = 2;
    let failure: unknown;
    function restore() {
      if (--remaining) return;
      try {
        let valid = false;
        if (current.result !== undefined) {
          try {
            decode(current.result);
            valid = true;
          } catch {
            /* Retain unreadable data below. */
          }
        }
        if (valid)
          throw new Error(
            "정상 기록이 있습니다. 덮어쓰지 않고 다시 불러와주세요.",
          );
        if (!checkpoint.result || checkpoint.result.data === undefined)
          throw new Error("복구 가능한 정상 저장본이 없습니다.");
        const recovered = decode(checkpoint.result.data);
        if (current.result !== undefined)
          store.add(current.result, `unreadable-${crypto.randomUUID()}`);
        store.put(recovered, "current");
      } catch (error) {
        failure = error;
        tx.abort();
      }
    }
    current.onsuccess = checkpoint.onsuccess = restore;
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        failure ?? new Error("복구하지 못했습니다. 기존 기록은 유지됩니다."),
      );
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
