const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  pickRootDirectory: () => ipcRenderer.invoke("devlog:pick-root-directory"),
  readTextFile: (payload) => ipcRenderer.invoke("devlog:read-text-file", payload),
  writeTextFile: (payload) => ipcRenderer.invoke("devlog:write-text-file", payload),
  ensureDirectory: (payload) => ipcRenderer.invoke("devlog:ensure-directory", payload),
  getDirectoryIfExists: (payload) => ipcRenderer.invoke("devlog:get-directory-if-exists", payload),
  listDirectory: (payload) => ipcRenderer.invoke("devlog:list-directory", payload),
  removeDirectory: (payload) => ipcRenderer.invoke("devlog:remove-directory", payload),
  getFileIfExists: (payload) => ipcRenderer.invoke("devlog:get-file-if-exists", payload),
  getFileText: (payload) => ipcRenderer.invoke("devlog:get-file-text", payload),
  saveFile: (payload) => ipcRenderer.invoke("devlog:save-file", payload),
  onFlushRequest: (callback) => {
    ipcRenderer.on("devlog:flush", async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send("devlog:flush-done");
      }
    });
  },
});
