"use client";

// Dialogs and panels for refunds/voids, the cash drawer (open, end-of-shift
// count), offline reconnect, and receipt/drawer settings.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Ban, Banknote, Printer, RotateCcw, Store, Wallet, WifiOff, X } from "lucide-react";
import type { CashSession } from "@/lib/cash-session";
import { expectedCash } from "@/lib/cash-session";
import { isDesktopApp, listPrinters, type DrawerMode, type HardwareSettings, type UpdateStatus } from "@/lib/hardware";
import { pesoDenominations, type StoreDetails } from "@/lib/receipts";

type PaymentMethod = "cash" | "e_wallet" | "card";
type RefundableOrder = {
  id: string;
  total: number;
  createdAt: Date;
  employeeName: string;
  paymentMethod: PaymentMethod;
  refundedTotal: number;
  lines: { id?: string; name: string; quantity: number; unitPrice: number; refundedQuantity: number }[];
};

const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const methodLabel = (method: string) => (method === "e_wallet" ? "E-Wallet" : method === "card" ? "Card" : "Cash");
const inputClass = "mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:border-slate-700 dark:bg-slate-950";
const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : fallback;

function KeyHint({ children }: { children: ReactNode }) {
  return <kbd className="hidden shrink-0 rounded border border-current px-1 py-px font-sans text-[9px] font-semibold uppercase leading-3 tracking-wide opacity-60 sm:inline-block">{children}</kbd>;
}

function Dialog({ label, eyebrow, title, subtitle, onClose, busy = false, children, wide = false }: {
  label: string; eyebrow: string; title: string; subtitle?: string; onClose: () => void; busy?: boolean; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 ${wide ? "max-w-xl" : "max-w-md"}`}>
        <div className="flex items-start justify-between p-6 pb-4">
          <div><p className="text-xs font-semibold text-blue-600">{eyebrow}</p><h2 className="mt-1 text-xl font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
          <button type="button" aria-label="Close (Esc)" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

function Actions({ busy, onCancel, submitLabel, tone = "blue", disabled = false }: { busy: boolean; onCancel: () => void; submitLabel: string; tone?: "blue" | "red"; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" disabled={busy} onClick={onCancel} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">Cancel <KeyHint>Esc</KeyHint></button>
      <button type="submit" disabled={busy || disabled} className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${tone === "red" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{busy ? "Working…" : <>{submitLabel} <KeyHint>Enter</KeyHint></>}</button>
    </div>
  );
}

// ---------- cash drawer ----------

export function DrawerStatusButton({ session, onOpen, onCount }: { session: CashSession | null; onOpen: () => void; onCount: () => void }) {
  const label = session ? `Drawer open · expected ${money(expectedCash(session))}. Click to count and close the shift.` : "No drawer session. Click to start the shift.";
  return (
    <button type="button" onClick={session ? onCount : onOpen} aria-label={label} title={label} className={`flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition ${session ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" : "text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
      <Wallet size={18} />
      <span className="hidden xl:inline">{session ? "Drawer open" : "Start shift"}</span>
    </button>
  );
}

export function OpenDrawerDialog({ onOpen, onClose, deviceLabel }: { onOpen: (openingFloat: number) => Promise<void>; onClose: () => void; deviceLabel: string }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount || "0");
    if (!Number.isFinite(value) || value < 0 || value > 99999999) return setError("Enter the cash in the drawer, ₱0 or more.");
    setBusy(true);
    await onOpen(Math.round(value * 100) / 100);
    setBusy(false);
  }
  return (
    <Dialog label="Start shift" eyebrow="CASH DRAWER" title="Start your shift" subtitle={`Count the cash in the drawer before the first sale${deviceLabel ? ` · ${deviceLabel}` : ""}.`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Opening cash (₱)
          <input autoFocus type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" className={inputClass} />
        </label>
        <p className="text-xs leading-5 text-slate-500">Cash sales and cash refunds on this computer are added up until you close the shift with a cash count. Works offline.</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Actions busy={busy} onCancel={onClose} submitLabel="Open drawer" />
      </form>
    </Dialog>
  );
}

export function CashCountDialog({ session, onConfirm, onClose, onOpenDrawer }: {
  session: CashSession;
  onConfirm: (count: { denominations: Record<string, number>; countedCash: number; notes: string; print: boolean }) => Promise<void>;
  onClose: () => void;
  onOpenDrawer: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [print, setPrint] = useState(true);
  const [busy, setBusy] = useState(false);
  const expected = expectedCash(session);
  const counted = useMemo(
    () => Math.round(pesoDenominations.reduce((sum, item) => sum + (Number(counts[item.label]) || 0) * item.value, 0) * 100) / 100,
    [counts],
  );
  const difference = Math.round((counted - expected) * 100) / 100;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const denominations = Object.fromEntries(pesoDenominations.map((item) => [item.label, Math.max(0, Math.floor(Number(counts[item.label]) || 0))]).filter(([, count]) => Number(count) > 0));
    await onConfirm({ denominations, countedCash: counted, notes: notes.trim().slice(0, 500), print });
    setBusy(false);
  }

  return (
    <Dialog wide label="End of shift cash count" eyebrow="END OF SHIFT" title="Count the cash drawer" subtitle={`Opened ${new Date(session.openedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })} by ${session.openedByName} · ${session.salesCount} sale${session.salesCount === 1 ? "" : "s"}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {pesoDenominations.map((item, index) => (
            <label key={item.label} className="block rounded-lg border border-slate-100 p-2 text-xs font-semibold dark:border-slate-800">{item.label}
              <input autoFocus={index === 0} type="number" min="0" step="1" inputMode="numeric" value={counts[item.label] ?? ""} onChange={(event) => { const { value } = event.currentTarget; setCounts((current) => ({ ...current, [item.label]: value })); }} placeholder="0" className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-normal outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950" />
            </label>
          ))}
        </div>
        <dl className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
          <div className="flex justify-between text-slate-500"><dt>Opening cash</dt><dd>{money(session.openingFloat)}</dd></div>
          <div className="flex justify-between text-slate-500"><dt>+ Cash sales</dt><dd>{money(session.cashSales)}</dd></div>
          <div className="flex justify-between text-slate-500"><dt>− Cash refunds</dt><dd>{money(session.cashRefunds)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Expected in drawer</dt><dd>{money(expected)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Counted</dt><dd>{money(counted)}</dd></div>
          <div className={`flex justify-between border-t border-dashed border-slate-200 pt-2 text-base font-bold dark:border-slate-700 ${difference === 0 ? "text-emerald-600" : difference > 0 ? "text-amber-600" : "text-red-600"}`}>
            <dt>{difference === 0 ? "Balanced" : difference > 0 ? "Over" : "Short"}</dt><dd>{money(Math.abs(difference))}</dd>
          </div>
        </dl>
        {Object.entries(session.otherSales).some(([, amount]) => amount !== 0) && (
          <p className="text-xs text-slate-500">Not in the drawer: {Object.entries(session.otherSales).filter(([, amount]) => amount !== 0).map(([method, amount]) => `${methodLabel(method)} ${money(amount)}`).join(" · ")}</p>
        )}
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes <span className="font-normal text-slate-400">(optional)</span>
          <input maxLength={500} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} placeholder={difference !== 0 ? "Explain the difference, if known" : ""} className={inputClass} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={print} onChange={(event) => setPrint(event.currentTarget.checked)} className="h-4 w-4 accent-blue-600" /> Print the shift report</label>
          <button type="button" onClick={onOpenDrawer} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"><Banknote size={14} /> Open drawer</button>
        </div>
        <Actions busy={busy} onCancel={onClose} submitLabel="Close shift" />
      </form>
    </Dialog>
  );
}

// ---------- voids and refunds ----------

export function VoidDialog({ order, onConfirm, onClose }: { order: RefundableOrder; onConfirm: (reason: string, printSlip: boolean) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [printSlip, setPrintSlip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return setError("Enter a reason for the void.");
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim().slice(0, 200), printSlip);
    } catch (caught) {
      setError(errorText(caught, "Unable to void the sale."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label="Void sale" eyebrow="VOID SALE" title={`Void ${order.id}?`} subtitle={`${money(order.total)} · ${methodLabel(order.paymentMethod)} · ${order.employeeName}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">The whole sale is cancelled: every item goes back into stock and {money(order.total)} is returned by {methodLabel(order.paymentMethod)}. Cashiers can void their own sales within 30 minutes; after that, an admin can.</p>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Reason
          <input autoFocus maxLength={200} value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="e.g. Rang up the wrong items" className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={printSlip} onChange={(event) => setPrintSlip(event.currentTarget.checked)} className="h-4 w-4 accent-blue-600" /> Print a void slip</label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Actions busy={busy} onCancel={onClose} submitLabel="Void sale" tone="red" />
      </form>
    </Dialog>
  );
}

export function RefundDialog({ order, onConfirm, onClose }: {
  order: RefundableOrder;
  onConfirm: (refund: { lines: { id: string; quantity: number }[]; reason: string; restock: boolean; method: PaymentMethod; printSlip: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const refundable = order.lines.filter((line) => line.id && line.quantity - line.refundedQuantity > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [printSlip, setPrintSlip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amount = refundable.reduce((sum, line) => sum + (quantities[line.id as string] ?? 0) * line.unitPrice, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lines = refundable.flatMap((line) => ((quantities[line.id as string] ?? 0) > 0 ? [{ id: line.id as string, quantity: quantities[line.id as string] }] : []));
    if (!lines.length) return setError("Choose how many of each item to refund.");
    if (!reason.trim()) return setError("Enter a reason for the refund.");
    setBusy(true);
    setError("");
    try {
      await onConfirm({ lines, reason: reason.trim().slice(0, 200), restock, method, printSlip });
    } catch (caught) {
      setError(errorText(caught, "Unable to record the refund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog wide label="Refund items" eyebrow="REFUND" title={`Refund items from ${order.id}`} subtitle={`${money(order.total)} sale${order.refundedTotal > 0 ? ` · ${money(order.refundedTotal)} already refunded` : ""}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {refundable.length === 0 ? <p className="text-sm text-slate-500">Everything in this sale has already been refunded.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {refundable.map((line) => {
              const left = line.quantity - line.refundedQuantity;
              const id = line.id as string;
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                  <div className="min-w-0"><p className="truncate font-semibold">{line.name}</p><p className="mt-0.5 text-[11px] text-slate-400">{money(line.unitPrice)} each · {left} of {line.quantity} refundable</p></div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input aria-label={`Refund quantity for ${line.name}`} type="number" min="0" max={left} step="1" value={quantities[id] ?? 0} onChange={(event) => { const quantity = Math.min(left, Math.max(0, Math.floor(Number(event.currentTarget.value) || 0))); setQuantities((current) => ({ ...current, [id]: quantity })); }} className="h-9 w-16 rounded-md border border-slate-200 bg-white px-2 text-right text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950" />
                    <button type="button" onClick={() => setQuantities((current) => ({ ...current, [id]: left }))} className="font-semibold text-blue-600 hover:text-blue-700">All</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Return money by
            <select value={method} onChange={(event) => setMethod(event.currentTarget.value as PaymentMethod)} className={inputClass}>
              {(["cash", "e_wallet", "card"] as const).map((option) => <option key={option} value={option}>{methodLabel(option)}{option === order.paymentMethod ? " (original)" : ""}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Reason
            <input maxLength={200} value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="e.g. Damaged item" className={inputClass} />
          </label>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(event) => setRestock(event.currentTarget.checked)} className="h-4 w-4 accent-blue-600" /> Put items back in stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={printSlip} onChange={(event) => setPrintSlip(event.currentTarget.checked)} className="h-4 w-4 accent-blue-600" /> Print a refund slip</label>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><span className="text-slate-500">Refund</span><span className="text-base font-bold">{money(amount)}</span></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Actions busy={busy} onCancel={onClose} submitLabel={`Refund ${money(amount)}`} tone="red" disabled={amount <= 0} />
      </form>
    </Dialog>
  );
}

export const VoidIcon = Ban;
export const RefundIcon = RotateCcw;

// ---------- offline sign-in: reconnect ----------

export function ReconnectBanner({ email, onReconnect }: { email: string; onReconnect: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onReconnect(password);
      setPassword("");
    } catch (caught) {
      setError(errorText(caught, "Couldn’t reconnect."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center justify-center gap-2 bg-blue-600 px-4 py-2 text-xs font-semibold text-white">
      <WifiOff size={14} />
      <span>Signed in offline as {email}. Enter your password to reconnect and sync your sales:</span>
      <input type="password" required autoComplete="current-password" aria-label="Password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="h-7 w-40 rounded-md border-0 bg-white px-2 text-xs text-slate-900 outline-none" />
      <button type="submit" disabled={busy || !password} className="h-7 rounded-md bg-white px-3 text-blue-700 disabled:opacity-60">{busy ? "Connecting…" : "Reconnect"}</button>
      {error && <span className="w-full text-center text-amber-200">{error}</span>}
    </form>
  );
}

// ---------- settings ----------

export function StoreDetailsCard({ details, canEdit, onSave }: { details: StoreDetails; canEdit: boolean; onSave: (details: StoreDetails) => Promise<void> }) {
  const [draft, setDraft] = useState(details);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(details), [details]);
  const field = (key: keyof StoreDetails, label: string, maxLength: number, placeholder = "") => (
    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">{label}
      <input disabled={!canEdit} maxLength={maxLength} value={draft[key]} placeholder={placeholder} onChange={(event) => { const { value } = event.currentTarget; setDraft((current) => ({ ...current, [key]: value })); }} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950" />
    </label>
  );
  return (
    <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSave(draft); setBusy(false); }} className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="mb-4 flex items-start gap-3"><Store size={18} className="mt-0.5 text-blue-600" /><div><h2 className="text-sm font-semibold">Store details on receipts</h2><p className="mt-1 text-xs leading-5 text-slate-500">Printed at the top and bottom of every receipt, on every till.{canEdit ? "" : " Only admins can change these."}</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("storeName", "Store name", 80)}
        {field("phone", "Phone", 40)}
        <div className="sm:col-span-2">{field("address", "Address", 200)}</div>
        {field("tin", "TIN (optional)", 40)}
        {field("receiptFooter", "Receipt message", 200, "Thank you for shopping with us!")}
      </div>
      {canEdit && <button type="submit" disabled={busy || !draft.storeName.trim()} className="mt-4 h-10 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? "Saving…" : "Save store details"}</button>}
    </form>
  );
}

export function HardwareSettingsCard({ settings, onChange, onTestPrint, onTestDrawer }: {
  settings: HardwareSettings;
  onChange: (settings: HardwareSettings) => void;
  onTestPrint: () => void;
  onTestDrawer: () => void;
}) {
  const desktop = isDesktopApp();
  const [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  useEffect(() => {
    if (desktop) void listPrinters().then(setPrinters).catch(() => setPrinters([]));
  }, [desktop]);
  const update = (patch: Partial<HardwareSettings>) => onChange({ ...settings, ...patch });
  const select = "mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950";
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="mb-4 flex items-start gap-3"><Printer size={18} className="mt-0.5 text-blue-600" /><div><h2 className="text-sm font-semibold">Receipts &amp; cash drawer · this computer</h2><p className="mt-1 text-xs leading-5 text-slate-500">{desktop ? "Receipts print straight to the selected printer." : "In the browser, receipts open the print dialog. Install the desktop app for one-click printing and direct cash drawer control."}</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Till name
          <input maxLength={60} value={settings.deviceLabel} onChange={(event) => update({ deviceLabel: event.currentTarget.value })} placeholder="e.g. Till 1" className={select} />
        </label>
        {desktop && (
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Receipt printer
            <select value={settings.printerName} onChange={(event) => update({ printerName: event.currentTarget.value })} className={select}>
              <option value="">System default printer</option>
              {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? " (default)" : ""}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Paper width
          <select value={settings.paperWidth} onChange={(event) => update({ paperWidth: Number(event.currentTarget.value) === 58 ? 58 : 80 })} className={select}>
            <option value={80}>80 mm</option><option value={58}>58 mm</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Cash drawer
          <select value={settings.drawerMode} onChange={(event) => update({ drawerMode: event.currentTarget.value as DrawerMode })} className={select}>
            <option value="none">No cash drawer</option>
            <option value="driver">Opened by the printer driver</option>
            {desktop && <option value="network">Network receipt printer (ESC/POS)</option>}
            {desktop && <option value="shared">Shared Windows printer (ESC/POS)</option>}
          </select>
        </label>
        {settings.drawerMode === "network" && (
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Printer IP address
              <input value={settings.drawerHost} onChange={(event) => update({ drawerHost: event.currentTarget.value.trim() })} placeholder="192.168.1.50" className={select} />
            </label>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Port
              <input type="number" min="1" max="65535" value={settings.drawerPort} onChange={(event) => update({ drawerPort: Math.floor(Number(event.currentTarget.value)) || 9100 })} className={select} />
            </label>
          </div>
        )}
        {settings.drawerMode === "shared" && (
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Printer share name
            <input value={settings.drawerShare} onChange={(event) => update({ drawerShare: event.currentTarget.value })} placeholder="e.g. POS-80" className={select} />
          </label>
        )}
      </div>
      {settings.drawerMode === "driver" && <p className="mt-3 text-[11px] leading-4 text-slate-500">Turn on “open cash drawer” in the printer driver’s settings (Windows → Printers → your printer → Printing preferences). The drawer then opens whenever a receipt prints.</p>}
      {settings.drawerMode === "shared" && <p className="mt-3 text-[11px] leading-4 text-slate-500">Share the printer in Windows (Printer properties → Sharing) and enter its share name. Works with ESC/POS printers whose driver accepts raw data.</p>}
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.autoPrint} onChange={(event) => update({ autoPrint: event.currentTarget.checked })} className="h-4 w-4 accent-blue-600" /> Print receipts by default (cashiers can switch it per sale at checkout, F7)</label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onTestPrint} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><Printer size={14} /> Print a test receipt</button>
        <button type="button" onClick={onTestDrawer} disabled={settings.drawerMode === "none"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"><Banknote size={14} /> Open the drawer</button>
      </div>
    </div>
  );
}

// ---------- live updates (desktop app) ----------

// Shown once a new version has downloaded. Restarting is the cashier's
// choice; otherwise it installs the next time the app is closed.
export function UpdateReadyBar({ version, busy, onRestart, testFeed = null }: { version: string | null; busy: boolean; onRestart: () => void; testFeed?: string | null }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white">
      <span>{testFeed && <span className="mr-2 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-950">Test update</span>}Clover POS {version ? `v${version}` : "update"} is ready. It installs when you close the app, or restart now (about 10 seconds).</span>
      <button type="button" onClick={onRestart} disabled={busy} className="h-6 rounded-md bg-white px-3 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">{busy ? "Restarting…" : "Restart to update"}</button>
    </div>
  );
}

export function UpdatesCard({ status, onCheck, onInstall }: {
  status: UpdateStatus | null;
  onCheck: () => Promise<void>;
  onInstall: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const describe = () => {
    if (!status) return "Checking the app version…";
    switch (status.state) {
      case "unsupported": return status.message ?? "Updates are only checked in the installed app.";
      case "checking": return "Checking for updates…";
      case "downloading": return `Downloading v${status.version ?? "?"}${status.percent !== null ? ` · ${status.percent}%` : ""}…`;
      case "ready": return `v${status.version} is downloaded and ready to install.`;
      case "current": return "You’re on the latest version.";
      case "error": return `Couldn’t check for updates: ${status.message ?? "unknown error"}`;
      default: return "Updates are checked automatically when the app starts and every few hours.";
    }
  };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><RotateCcw size={18} className="mt-0.5 text-blue-600" /><div><h2 className="text-sm font-semibold">App updates</h2><p className="mt-1 text-xs leading-5 text-slate-500">Installed version: {status?.currentVersion ? `v${status.currentVersion}` : "—"} · {describe()}</p>{status?.testFeed && <p className="mt-1.5 inline-flex rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Test mode: updates come from {status.testFeed} (npm run update:test), not GitHub.</p>}</div></div>
        {status?.state === "ready" ? (
          <button type="button" onClick={onInstall} className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">Restart to update</button>
        ) : (
          <button type="button" disabled={busy || status?.state === "unsupported" || status?.state === "checking" || status?.state === "downloading"} onClick={async () => { setBusy(true); await onCheck(); setBusy(false); }} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">{busy ? "Checking…" : "Check for updates"}</button>
        )}
      </div>
    </div>
  );
}
