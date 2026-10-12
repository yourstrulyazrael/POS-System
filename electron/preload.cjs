// Exposes a narrow hardware API to the page. The page never gets Node.js or
// Electron access; every call is validated again in the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  listPrinters: () => ipcRenderer.invoke("pos:list-printers"),
  printHtml: (html, options) => ipcRenderer.invoke("pos:print-html", html, options),
  openDrawer: (options) => ipcRenderer.invoke("pos:open-drawer", options),
});
