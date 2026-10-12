// Exposes a narrow hardware/update API to the page. The page never gets
// Node.js or Electron access; every call is validated again in the main
// process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  listPrinters: () => ipcRenderer.invoke("pos:list-printers"),
  printHtml: (html, options) => ipcRenderer.invoke("pos:print-html", html, options),
  openDrawer: (options) => ipcRenderer.invoke("pos:open-drawer", options),

  getUpdateStatus: () => ipcRenderer.invoke("pos:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("pos:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("pos:install-update"),
  // Returns an unsubscribe function. Only the status object is passed on.
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("pos:update-status", listener);
    return () => ipcRenderer.removeListener("pos:update-status", listener);
  },
});
