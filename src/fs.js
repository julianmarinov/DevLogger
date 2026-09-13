const DB_NAME = "devlog-local";
const STORE_NAME = "handles";
const LOCAL_HANDLE_PREFIX = "devlog-handle:";

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

function electronApi() {
  return typeof window !== "undefined" ? window.electronAPI || null : null;
}

function isElectronRuntime() {
  return Boolean(electronApi());
}

function handleKey(key) {
  return `${LOCAL_HANDLE_PREFIX}${key}`;
}

function buildVirtualHandle(kind, absolutePath) {
  const normalized = absolutePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const name = segments[segments.length - 1] || normalized;

  return {
    kind,
    name,
    path: absolutePath,
  };
}

export function isDesktopEnvironment() {
  return isElectronRuntime();
}

export function onDesktopFlushRequest(callback) {
  electronApi()?.onFlushRequest?.(callback);
}

export function isFileSystemAccessSupported() {
  return isElectronRuntime() || (typeof window !== "undefined" && "showDirectoryPicker" in window);
}

export async function saveHandle(key, handle) {
  if (isElectronRuntime()) {
    localStorage.setItem(handleKey(key), JSON.stringify(handle));
    return;
  }

  return withStore("readwrite", (store) => store.put(handle, key));
}

export async function loadHandle(key) {
  if (isElectronRuntime()) {
    const raw = localStorage.getItem(handleKey(key));
    return raw ? JSON.parse(raw) : null;
  }

  return withStore("readonly", (store) => store.get(key));
}

export async function clearHandle(key) {
  if (isElectronRuntime()) {
    localStorage.removeItem(handleKey(key));
    return;
  }

  return withStore("readwrite", (store) => store.delete(key));
}

export async function ensurePermission(handle) {
  if (!handle) {
    return false;
  }

  if (isElectronRuntime()) {
    return true;
  }

  const options = { mode: "readwrite" };
  const current = await handle.queryPermission(options);
  return current === "granted";
}

export async function requestPermission(handle) {
  if (!handle) {
    return false;
  }

  if (isElectronRuntime()) {
    return true;
  }

  const result = await handle.requestPermission({ mode: "readwrite" });
  return result === "granted";
}

export async function pickRootDirectory() {
  if (isElectronRuntime()) {
    const pickedPath = await electronApi().pickRootDirectory();
    return pickedPath ? buildVirtualHandle("directory", pickedPath) : null;
  }

  return window.showDirectoryPicker({
    id: "devlog-root",
    mode: "readwrite",
  });
}

export async function readTextFile(directoryHandle, fileName) {
  if (isElectronRuntime()) {
    return electronApi().readTextFile({
      directoryPath: directoryHandle.path,
      fileName,
    });
  }

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
  if (isElectronRuntime()) {
    return electronApi().writeTextFile({
      directoryPath: directoryHandle.path,
      fileName,
      text,
    });
  }

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
  if (isElectronRuntime()) {
    const directoryPath = await electronApi().ensureDirectory({
      parentPath: parentHandle.path,
      directoryName,
    });
    return buildVirtualHandle("directory", directoryPath);
  }

  return parentHandle.getDirectoryHandle(directoryName, { create: true });
}

export async function getDirectoryIfExists(parentHandle, directoryName) {
  if (isElectronRuntime()) {
    const directoryPath = await electronApi().getDirectoryIfExists({
      parentPath: parentHandle.path,
      directoryName,
    });
    return directoryPath ? buildVirtualHandle("directory", directoryPath) : null;
  }

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
  if (isElectronRuntime()) {
    const entries = await electronApi().listDirectory({
      directoryPath: parentHandle.path,
    });

    return entries.map((entry) => ({
      ...entry,
      handle: buildVirtualHandle(entry.kind, entry.path),
    }));
  }

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
  if (isElectronRuntime()) {
    await electronApi().removeDirectory({
      parentPath: parentHandle.path,
      directoryName,
    });
    return;
  }

  await parentHandle.removeEntry(directoryName, { recursive: true });
}

export async function getFileIfExists(parentHandle, fileName) {
  if (isElectronRuntime()) {
    const filePath = await electronApi().getFileIfExists({
      parentPath: parentHandle.path,
      fileName,
    });
    return filePath ? buildVirtualHandle("file", filePath) : null;
  }

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
  if (isElectronRuntime()) {
    return electronApi().getFileText({
      filePath: fileHandle.path,
    });
  }

  const file = await fileHandle.getFile();
  return {
    text: await file.text(),
    lastModified: file.lastModified,
  };
}

export async function saveBlobFile(blob, suggestedName, mimeType) {
  if (isElectronRuntime()) {
    const buffer = await blob.arrayBuffer();
    return electronApi().saveFile({
      suggestedName,
      mimeType,
      bytes: new Uint8Array(buffer),
    });
  }

  if ("showSaveFilePicker" in window) {
    const extension = suggestedName.split(".").pop();
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: mimeType,
          accept: {
            [mimeType]: [`.${extension}`],
          },
        },
      ],
    });

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function collectProjectFiles(projectHandle, relativePrefix = "") {
  const files = [];
  const entries = await listDirectory(projectHandle);

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

    if (entry.kind === "file") {
      const file = await getFileText(entry.handle);
      files.push({
        path: relativePath,
        text: file.text,
        lastModified: file.lastModified,
      });
      continue;
    }

    const nestedFiles = await collectProjectFiles(entry.handle, relativePath);
    files.push(...nestedFiles);
  }

  return files;
}
