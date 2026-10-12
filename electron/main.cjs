// Clover POS desktop shell.
//
// Serves the static Next.js export (out/) over a private app:// scheme and
// keeps the window locked down: no Node.js in the page, sandboxed renderer,
// no navigation away from the app, and a strict Content Security Policy.
// All data goes to Supabase over HTTPS using the public key baked into out/.
const { app, BrowserWindow, Menu, nativeTheme, net, protocol, session, shell } = require("electron");
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
