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

type DesktopBridge = {
  listPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  printHtml: (html: string, options: { printerName: string; paperWidth: number }) => Promise<void>;
  openDrawer: (options: { mode: "network" | "shared"; host: string; port: number; share: string }) => Promise<void>;
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
