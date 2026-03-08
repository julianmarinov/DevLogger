const DB_NAME = "devlog-local";
const STORE_NAME = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
  });
}

async function withStore(mode, callback) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function saveHandle(key, handle) {
  return withStore("readwrite", (store) => store.put(handle, key));
}

export async function loadHandle(key) {
  return withStore("readonly", (store) => store.get(key));
}

export async function clearHandle(key) {
  return withStore("readwrite", (store) => store.delete(key));
}

export async function ensurePermission(handle) {
  if (!handle) {
    return false;
  }

  const options = { mode: "readwrite" };
  const current = await handle.queryPermission(options);

  if (current === "granted") {
    return true;
  }

  return false;
}

export async function requestPermission(handle) {
  if (!handle) {
    return false;
  }

  const result = await handle.requestPermission({ mode: "readwrite" });
  return result === "granted";
}

export async function pickRootDirectory() {
  return window.showDirectoryPicker({
    id: "devlog-root",
    mode: "readwrite",
  });
}

export async function readTextFile(directoryHandle, fileName) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return {
      exists: true,
      text: await file.text(),
      fileHandle,
      lastModified: file.lastModified,
    };
  } catch (error) {
    if (error.name === "NotFoundError") {
      return {
        exists: false,
        text: "",
        fileHandle: null,
        lastModified: 0,
      };
    }

    throw error;
  }
}

export async function readJsonFile(directoryHandle, fileName) {
  const result = await readTextFile(directoryHandle, fileName);

  if (!result.exists || !result.text.trim()) {
    return {
      ...result,
      value: null,
    };
  }

  return {
    ...result,
    value: JSON.parse(result.text),
  };
}

export async function writeTextFile(directoryHandle, fileName, text) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();

  const file = await fileHandle.getFile();

  return {
    fileHandle,
    lastModified: file.lastModified,
  };
}

export async function writeJsonFile(directoryHandle, fileName, value) {
  return writeTextFile(directoryHandle, fileName, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensureDirectory(parentHandle, directoryName) {
  return parentHandle.getDirectoryHandle(directoryName, { create: true });
}

export async function getDirectoryIfExists(parentHandle, directoryName) {
  try {
    return await parentHandle.getDirectoryHandle(directoryName);
  } catch (error) {
    if (error.name === "NotFoundError") {
      return null;
    }

    throw error;
  }
}

export async function listDirectory(parentHandle) {
  const entries = [];

  for await (const [name, handle] of parentHandle.entries()) {
    entries.push({
      name,
      handle,
      kind: handle.kind,
    });
  }

  return entries;
}

export async function removeDirectory(parentHandle, directoryName) {
  await parentHandle.removeEntry(directoryName, { recursive: true });
}

export async function getFileIfExists(parentHandle, fileName) {
  try {
    return await parentHandle.getFileHandle(fileName);
  } catch (error) {
    if (error.name === "NotFoundError") {
      return null;
    }

    throw error;
  }
}

export async function getFileText(fileHandle) {
  const file = await fileHandle.getFile();
  return {
    text: await file.text(),
    lastModified: file.lastModified,
  };
}

export async function collectProjectFiles(projectHandle, relativePrefix = "") {
  const files = [];
  const entries = await listDirectory(projectHandle);

  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.kind === "file") {
      const fileHandle = await projectHandle.getFileHandle(entry.name);
      const file = await fileHandle.getFile();
      files.push({
        path: relativePath,
        text: await file.text(),
        lastModified: file.lastModified,
      });
      continue;
    }

    const directoryHandle = await projectHandle.getDirectoryHandle(entry.name);
    const nestedFiles = await collectProjectFiles(directoryHandle, relativePath);
    files.push(...nestedFiles);
  }

  return files;
}
