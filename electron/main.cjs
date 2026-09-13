const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

let mainWindow = null;
let isQuitting = false;

// Keep development runs from sharing settings (and the single-instance lock) with an installed copy.
if (!app.isPackaged && !app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "Devlog-dev"));
}

const hasInstanceLock = app.requestSingleInstanceLock();

if (!hasInstanceLock) {
  app.quit();
}

const FLUSH_TIMEOUT_MS = 2000;

function isSafeExternalUrl(url) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function openExternalSafely(url) {
  if (isSafeExternalUrl(url)) {
    shell.openExternal(url);
  }
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#f4efe4",
    autoHideMenuBar: true,
    title: "Devlog",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const window = mainWindow;
  let flushed = false;

  // Give the renderer a chance to write pending edits before the window goes away.
  window.on("close", (event) => {
    if (flushed || window.webContents.isDestroyed()) {
      return;
    }

    event.preventDefault();

    const finish = () => {
      if (flushed) {
        return;
      }
      flushed = true;
      clearTimeout(timer);
      ipcMain.removeListener("devlog:flush-done", onDone);
      window.close();

      // Preventing the close cancels an in-progress quit, so resume it.
      if (isQuitting) {
        app.quit();
      }
    };
    const onDone = (ipcEvent) => {
      if (ipcEvent.sender === window.webContents) {
        finish();
      }
    };
    const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);

    ipcMain.on("devlog:flush-done", onDone);
    window.webContents.send("devlog:flush");
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  // Reloads of the app page are fine; anything else (links, dropped files) must not replace the UI.
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    openExternalSafely(url);
  });

  await window.loadFile(path.join(__dirname, "..", "index.html"));
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!hasInstanceLock) {
    return;
  }

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("devlog:pick-root-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Devlog Root Folder",
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return normalizePath(result.filePaths[0]);
});

ipcMain.handle("devlog:read-text-file", async (_event, payload) => {
  const filePath = path.join(payload.directoryPath, payload.fileName);

  try {
    const stats = await fs.stat(filePath);
    const text = await fs.readFile(filePath, "utf8");
    return {
      exists: true,
      text,
      lastModified: stats.mtimeMs,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        exists: false,
        text: "",
        lastModified: 0,
      };
    }

    throw error;
  }
});

ipcMain.handle("devlog:write-text-file", async (_event, payload) => {
  const filePath = path.join(payload.directoryPath, payload.fileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, payload.text, "utf8");
  const stats = await fs.stat(filePath);

  return {
    lastModified: stats.mtimeMs,
    path: normalizePath(filePath),
  };
});

ipcMain.handle("devlog:ensure-directory", async (_event, payload) => {
  const directoryPath = path.join(payload.parentPath, payload.directoryName);
  await fs.mkdir(directoryPath, { recursive: true });
  return normalizePath(directoryPath);
});

ipcMain.handle("devlog:get-directory-if-exists", async (_event, payload) => {
  const directoryPath = path.join(payload.parentPath, payload.directoryName);

  if (!(await pathExists(directoryPath))) {
    return null;
  }

  const stats = await fs.stat(directoryPath);
  return stats.isDirectory() ? normalizePath(directoryPath) : null;
});

ipcMain.handle("devlog:list-directory", async (_event, payload) => {
  const entries = await fs.readdir(payload.directoryPath, { withFileTypes: true });

  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? "directory" : "file",
    path: normalizePath(path.join(payload.directoryPath, entry.name)),
  }));
});

ipcMain.handle("devlog:remove-directory", async (_event, payload) => {
  const directoryPath = path.join(payload.parentPath, payload.directoryName);
  await fs.rm(directoryPath, { recursive: true, force: true });
});

ipcMain.handle("devlog:get-file-if-exists", async (_event, payload) => {
  const filePath = path.join(payload.parentPath, payload.fileName);

  if (!(await pathExists(filePath))) {
    return null;
  }

  const stats = await fs.stat(filePath);
  return stats.isFile() ? normalizePath(filePath) : null;
});

ipcMain.handle("devlog:get-file-text", async (_event, payload) => {
  const stats = await fs.stat(payload.filePath);
  const text = await fs.readFile(payload.filePath, "utf8");

  return {
    text,
    lastModified: stats.mtimeMs,
  };
});

ipcMain.handle("devlog:save-file", async (_event, payload) => {
  const filters = [];
  const extension = payload.suggestedName.includes(".") ? payload.suggestedName.split(".").pop() : "";

  if (extension) {
    filters.push({
      name: payload.mimeType || "File",
      extensions: [extension],
    });
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Export",
    defaultPath: payload.suggestedName,
    filters,
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, Buffer.from(payload.bytes));
  return normalizePath(result.filePath);
});
