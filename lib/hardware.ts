// Receipt printer and cash drawer access.
//
// In the desktop app, electron/preload.cjs exposes window.posDesktop: silent
// printing to a chosen printer and ESC/POS "open drawer" pulses. In a browser
// there is no direct hardware access, so receipts go through the print dialog
// and the drawer can only open via the printer driver's own setting.

export type DrawerMode = "none" | "driver" | "network" | "shared";

export type HardwareSettings = {
  printerName: string; // "" = system default printer
  paperWidth: 58 | 80;
  autoPrint: boolean; // print a receipt after every sale
  drawerMode: DrawerMode;
  drawerHost: string; // network ESC/POS printer (mode "network")
  drawerPort: number;
  drawerShare: string; // shared Windows printer name (mode "shared")
  deviceLabel: string; // shown on cash counts, e.g. "Till 1"
};

export type UpdateStatus = {
  state: "idle" | "unsupported" | "checking" | "current" | "downloading" | "ready" | "error";
  version: string | null; // the new version, once one is found
  percent: number | null;
  message: string | null;
  currentVersion?: string;
  testFeed?: string | null; // set when testing against a local update server
};

type DesktopBridge = {
  listPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  printHtml: (html: string, options: { printerName: string; paperWidth: number }) => Promise<void>;
  openDrawer: (options: { mode: "network" | "shared"; host: string; port: number; share: string }) => Promise<void>;
  // Live updates (installed desktop app only).
  getUpdateStatus?: () => Promise<UpdateStatus>;
  checkForUpdates?: () => Promise<UpdateStatus>;
  installUpdate?: () => Promise<void>;
  onUpdateStatus?: (callback: (status: UpdateStatus) => void) => () => void;
};

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

const SETTINGS_KEY = "clover-pos-hardware";
export const defaultHardwareSettings: HardwareSettings = {
  printerName: "",
  paperWidth: 80,
  autoPrint: false,
  drawerMode: "none",
  drawerHost: "",
  drawerPort: 9100,
  drawerShare: "",
  deviceLabel: "",
};

export const isDesktopApp = () => typeof window !== "undefined" && !!window.posDesktop;

export function loadHardwareSettings(): HardwareSettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<HardwareSettings>;
    return { ...defaultHardwareSettings, ...saved };
  } catch {
    return defaultHardwareSettings;
  }
}

export function saveHardwareSettings(settings: HardwareSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not critical: the settings apply for this visit.
  }
}

// ---------- live updates (desktop app) ----------

export const supportsLiveUpdates = () => typeof window !== "undefined" && !!window.posDesktop?.onUpdateStatus;

export function watchUpdateStatus(onChange: (status: UpdateStatus) => void) {
  const bridge = window.posDesktop;
  if (!bridge?.onUpdateStatus || !bridge.getUpdateStatus) return () => undefined;
  let currentVersion: string | undefined;
  void bridge.getUpdateStatus().then((status) => {
    currentVersion = status.currentVersion;
    onChange(status);
  }).catch(() => undefined);
  return bridge.onUpdateStatus((status) => onChange({ ...status, currentVersion: status.currentVersion ?? currentVersion }));
}

export async function checkForUpdates() {
  if (!window.posDesktop?.checkForUpdates) throw new Error("Updates are available in the desktop app.");
  return window.posDesktop.checkForUpdates();
}

export async function installUpdate() {
  if (!window.posDesktop?.installUpdate) throw new Error("Updates are available in the desktop app.");
  await window.posDesktop.installUpdate();
}

export async function listPrinters() {
  return window.posDesktop ? window.posDesktop.listPrinters() : [];
}

// Prints a receipt document. Desktop: silently to the chosen printer.
// Browser: through the print dialog, from a hidden frame.
export async function printDocument(html: string, settings: HardwareSettings) {
  if (window.posDesktop) {
    await window.posDesktop.printHtml(html, { printerName: settings.printerName, paperWidth: settings.paperWidth });
    return;
  }
  await new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        return resolve();
      }
      printWindow.addEventListener("afterprint", () => window.setTimeout(() => frame.remove(), 500), { once: true });
      printWindow.focus();
      printWindow.print();
      resolve();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

// Opens the cash drawer. "driver" relies on the printer driver opening it
// when a receipt prints, so there's nothing to send here.
export async function openCashDrawer(settings: HardwareSettings) {
  if (settings.drawerMode === "none" || settings.drawerMode === "driver") return false;
  if (!window.posDesktop) throw new Error("Opening the drawer directly needs the desktop app.");
  await window.posDesktop.openDrawer({
    mode: settings.drawerMode,
    host: settings.drawerHost,
    port: settings.drawerPort,
    share: settings.drawerShare,
  });
  return true;
}
