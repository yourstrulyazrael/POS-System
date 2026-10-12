// Clover POS desktop shell.
//
// Serves the static Next.js export (out/) over a private app:// scheme and
// keeps the window locked down: no Node.js in the page, sandboxed renderer,
// no navigation away from the app, and a strict Content Security Policy.
// All data goes to Supabase over HTTPS using the public key baked into out/.
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, protocol, session, shell } = require("electron");
const netSocket = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const HOST = "pos";
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const isDev = process.argv.includes("--dev");
const DEV_URL = "http://localhost:3000";
const OUT_DIR = path.join(__dirname, "..", "out");

// Next inlines its bootstrap scripts and styles, hence 'unsafe-inline';
// everything else must come from the app itself, and network calls may only
// go to HTTPS/WSS endpoints (Supabase).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' about:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Only one copy of the POS should run at a time; a second launch focuses it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- static file serving ----------

function resolveAppFile(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const target = path.normalize(path.join(OUT_DIR, decoded));
  if (target !== OUT_DIR && !target.startsWith(OUT_DIR + path.sep)) return null; // path traversal
  const candidates = decoded.endsWith("/") || !path.extname(target)
    ? [path.join(target, "index.html"), `${target}.html`]
    : [target];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

async function serveAppRequest(request) {
  const { host, pathname } = new URL(request.url);
  const file = host === HOST ? resolveAppFile(pathname) : null;
  const notFound = path.join(OUT_DIR, "404.html");
  const response = await net.fetch(pathToFileURL(file ?? notFound).toString());
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: file ? 200 : 404, headers });
}

// ---------- receipt printer and cash drawer ----------

// Only the app's own page may use the hardware handlers.
function fromAppPage(event) {
  const url = event.senderFrame?.url ?? "";
  return isAppUrl(url) || url === `${APP_ORIGIN}/`;
}

// ESC p 0 25 250: pulse drawer pin 2 (the standard ESC/POS drawer kick).
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

function sendToNetworkPrinter(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = netSocket.createConnection({ host, port, timeout: 4000 }, () => {
      socket.end(data, resolve);
    });
    socket.on("timeout", () => { socket.destroy(); reject(new Error(`No response from ${host}:${port}.`)); });
    socket.on("error", (error) => reject(new Error(`Couldn’t reach the printer at ${host}:${port} (${error.code ?? error.message}).`)));
  });
}

async function printHtml(html, { printerName, paperWidth }) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  // The receipt is a self-contained document; it may not navigate anywhere.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Size the page to the receipt so roll paper is cut right after it.
    const heightPx = await window.webContents.executeJavaScript("document.documentElement.scrollHeight");
    const heightMicrons = Math.max(Math.ceil(Number(heightPx) * 264.583) + 6000, 60000);
    await new Promise((resolve, reject) => {
      window.webContents.print({
        silent: true,
        deviceName: printerName || undefined,
        printBackground: false,
        margins: { marginType: "none" },
        pageSize: { width: paperWidth * 1000, height: heightMicrons },
      }, (success, failureReason) => (success ? resolve() : reject(new Error(failureReason || "The printer didn’t accept the receipt."))));
    });
  } finally {
    window.destroy();
  }
}

function registerHardwareHandlers() {
  ipcMain.handle("pos:list-printers", async (event) => {
    if (!fromAppPage(event) || !mainWindow) throw new Error("Not allowed.");
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name, isDefault: !!printer.isDefault }));
  });

  ipcMain.handle("pos:print-html", async (event, html, options) => {
    if (!fromAppPage(event)) throw new Error("Not allowed.");
    if (typeof html !== "string" || html.length > 2_000_000) throw new Error("Invalid receipt.");
    const printerName = typeof options?.printerName === "string" ? options.printerName.slice(0, 200) : "";
    const paperWidth = options?.paperWidth === 58 ? 58 : 80;
    await printHtml(html, { printerName, paperWidth });
  });

  ipcMain.handle("pos:open-drawer", async (event, options) => {
    if (!fromAppPage(event)) throw new Error("Not allowed.");
    if (options?.mode === "network") {
      const host = String(options.host ?? "");
      const port = Number(options.port);
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Enter the printer’s IP address (or host name) and port.");
      }
      await sendToNetworkPrinter(host, port, DRAWER_KICK);
      return;
    }
    if (options?.mode === "shared") {
      if (process.platform !== "win32") throw new Error("Shared-printer drawers are supported on Windows only.");
      const share = String(options.share ?? "");
      if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(share)) throw new Error("Enter the printer’s Windows share name.");
      // Raw bytes to a shared printer: \\localhost\<share>.
      await fs.promises.writeFile(`\\\\localhost\\${share}`, DRAWER_KICK);
      return;
    }
    throw new Error("Choose how the cash drawer is connected.");
  });
}

// ---------- live updates ----------
//
// Installed copies check GitHub Releases (package.json → build.publish) for a
// newer version, download it in the background, and tell the page. It
// installs when the cashier clicks "Restart to update", or automatically the
// next time the app is closed — never in the middle of a sale.

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateStatus = { state: "idle", version: null, percent: null, message: null };

function setUpdateStatus(patch) {
  updateStatus = { ...updateStatus, ...patch };
  mainWindow?.webContents.send("pos:update-status", updateStatus);
}

function setupLiveUpdates() {
  if (!app.isPackaged || isDev) {
    updateStatus = { ...updateStatus, state: "unsupported", message: "Updates are only checked in the installed app." };
    return;
  }
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => setUpdateStatus({ state: "checking", message: null }));
  autoUpdater.on("update-not-available", () => setUpdateStatus({ state: "current", percent: null, message: null }));
  autoUpdater.on("update-available", (info) => setUpdateStatus({ state: "downloading", version: info.version, percent: 0, message: null }));
  autoUpdater.on("download-progress", (progress) => setUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateStatus({ state: "ready", version: info.version, percent: 100, message: null }));
  autoUpdater.on("error", (error) => setUpdateStatus({ state: "error", message: error?.message ? String(error.message).split("\n")[0].slice(0, 200) : "Update check failed." }));

  const check = () => autoUpdater.checkForUpdates().catch(() => undefined); // errors arrive via the "error" event
  setTimeout(check, 15_000);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);

  ipcMain.handle("pos:check-for-updates", async (event) => {
    if (!fromAppPage(event)) throw new Error("Not allowed.");
    await check();
    return updateStatus;
  });
  ipcMain.handle("pos:install-update", (event) => {
    if (!fromAppPage(event)) throw new Error("Not allowed.");
    if (updateStatus.state !== "ready") throw new Error("No update is ready to install.");
    // Silent install, then reopen the app on the new version.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
}

function registerUpdateInfoHandlers() {
  ipcMain.handle("pos:get-update-status", (event) => {
    if (!fromAppPage(event)) throw new Error("Not allowed.");
    return { ...updateStatus, currentVersion: app.getVersion() };
  });
  // Present in dev too, so the page can show a clear message.
  if (!app.isPackaged || isDev) {
    ipcMain.handle("pos:check-for-updates", (event) => {
      if (!fromAppPage(event)) throw new Error("Not allowed.");
      return updateStatus;
    });
    ipcMain.handle("pos:install-update", () => {
      throw new Error("Updates are only installed in the installed app.");
    });
  }
}

// ---------- window state ----------

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (Number.isFinite(state.width) && Number.isFinite(state.height)) return state;
  } catch {
    // First launch or unreadable file: use defaults.
  }
  return { width: 1366, height: 860, maximized: true };
}

function saveWindowState(window) {
  try {
    const bounds = window.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: window.isMaximized() }));
  } catch {
    // Not critical; the next launch falls back to defaults.
  }
}

// ---------- window ----------

let mainWindow = null;

function isAppUrl(url) {
  return url.startsWith(`${APP_ORIGIN}/`) || (isDev && url.startsWith(`${DEV_URL}/`));
}

function openExternally(url) {
  if (/^https:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
}

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Clover POS",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#020617" : "#f5f8fd",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: isDev || !app.isPackaged,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  if (state.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", () => saveWindowState(mainWindow));
  mainWindow.on("closed", () => { mainWindow = null; });

  // Stay inside the app; real web links open in the default browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });

  // Desktop zoom shortcuts (there is no menu bar to provide them).
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    const contents = mainWindow.webContents;
    if (input.key === "=" || input.key === "+") contents.setZoomLevel(Math.min(contents.getZoomLevel() + 0.5, 3));
    else if (input.key === "-") contents.setZoomLevel(Math.max(contents.getZoomLevel() - 0.5, -3));
    else if (input.key === "0") contents.setZoomLevel(0);
    else if (input.shift && input.key.toLowerCase() === "i" && (isDev || !app.isPackaged)) contents.toggleDevTools();
    else return;
    event.preventDefault();
  });

  void mainWindow.loadURL(isDev ? DEV_URL : `${APP_ORIGIN}/`);
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // No menu bar: it would steal the Alt key from the app's Alt+1–8 shortcuts.
  Menu.setApplicationMenu(null);

  protocol.handle(SCHEME, serveAppRequest);
  registerHardwareHandlers();
  registerUpdateInfoHandlers();
  setupLiveUpdates();

  // The POS needs no camera, microphone, location or notifications. Only
  // clipboard writes ("Copy order number") are allowed.
  const allowed = new Set(["clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
