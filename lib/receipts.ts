// Printable receipts for thermal printers (58 mm / 80 mm roll paper).
// Each builder returns a complete HTML document: no scripts, no external
// resources (blocked by its own CSP), every value escaped.

import { formatQuantity, itemCountOf, lineAmount } from "@/lib/quantity";

export type StoreDetails = {
  storeName: string;
  address: string;
  phone: string;
  tin: string;
  receiptFooter: string;
};

export const defaultStoreDetails: StoreDetails = {
  storeName: "Clover & Co.",
  address: "",
  phone: "",
  tin: "",
  receiptFooter: "Thank you for shopping with us!",
};

type Line = { name: string; quantity: number; unitPrice: number; wholesale?: boolean };

const peso = (amount: number) => `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dateTime = (date: Date) => date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
const methodLabel = (method: string) => (method === "e_wallet" ? "E-Wallet" : method === "card" ? "Card" : "Cash");

function documentHtml(title: string, paperWidth: 58 | 80, body: string) {
  const contentWidth = paperWidth === 58 ? 48 : 72;
  const fontSize = paperWidth === 58 ? 10.5 : 12;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title><style>
  @page { size: ${paperWidth}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${contentWidth}mm; margin: 0 auto; padding: 3mm 0 4mm; font: ${fontSize}px/1.35 "Consolas", "Courier New", monospace; }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: 700; }
  .store { font-size: ${fontSize + 3}px; font-weight: 700; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.4mm 0; vertical-align: top; }
  td.amount { text-align: right; white-space: nowrap; padding-left: 2mm; }
  .item-detail { padding-left: 2mm; font-size: ${fontSize - 1}px; }
  .total td { font-weight: 700; font-size: ${fontSize + 2}px; }
  .stamp { border: 1.5px solid #000; padding: 1mm; margin: 2mm 0; text-align: center; font-weight: 700; }
  .muted { font-size: ${fontSize - 1.5}px; }
</style></head><body>${body}</body></html>`;
}

function header(store: StoreDetails) {
  return `<div class="center">
    <div class="store">${escapeHtml(store.storeName || "Store")}</div>
    ${store.address ? `<div>${escapeHtml(store.address)}</div>` : ""}
    ${store.phone ? `<div>${escapeHtml(store.phone)}</div>` : ""}
    ${store.tin ? `<div>TIN ${escapeHtml(store.tin)}</div>` : ""}
  </div>`;
}

const row = (label: string, value: string, className = "") => `<tr class="${className}"><td>${label}</td><td class="amount">${value}</td></tr>`;

function linesTable(lines: Line[]) {
  return `<table>${lines.map((line) => `
    <tr><td colspan="2">${escapeHtml(line.name)}</td></tr>
    <tr><td class="item-detail">${formatQuantity(line.quantity)} × ${peso(line.unitPrice)}${line.wholesale ? " (wholesale)" : ""}</td><td class="amount">${peso(lineAmount(line.unitPrice, line.quantity))}</td></tr>`).join("")}
  </table>`;
}

export type SaleReceipt = {
  orderNumber: string;
  createdAt: Date;
  cashier: string;
  lines: Line[];
  total: number;
  paymentMethod: string;
  paymentReferenceLast4: string | null;
  cashReceived: number | null;
  changeDue: number | null;
  wholesale: boolean;
  pendingSync: boolean;
  status: "completed" | "voided";
  refundedTotal: number;
  reprint: boolean;
};

export function buildSaleReceipt(store: StoreDetails, sale: SaleReceipt, paperWidth: 58 | 80) {
  const items = sale.lines.reduce((sum, line) => sum + itemCountOf(line.quantity), 0);
  const body = `${header(store)}
    <div class="rule"></div>
    <div>Receipt ${escapeHtml(sale.orderNumber)}</div>
    <div>${escapeHtml(dateTime(sale.createdAt))}</div>
    <div>Cashier: ${escapeHtml(sale.cashier)}</div>
    ${sale.wholesale && !sale.lines.some((line) => line.wholesale) ? `<div class="bold">WHOLESALE PRICING</div>` : ""}
    ${sale.reprint ? `<div class="stamp">REPRINT</div>` : ""}
    ${sale.status === "voided" ? `<div class="stamp">VOIDED</div>` : ""}
    <div class="rule"></div>
    ${linesTable(sale.lines)}
    <div class="rule"></div>
    <table>
      ${row(`Items`, String(items))}
      ${row("TOTAL", peso(sale.total), "total")}
      ${row(`Paid by ${methodLabel(sale.paymentMethod)}`, sale.cashReceived !== null ? peso(sale.cashReceived) : peso(sale.total))}
      ${sale.paymentReferenceLast4 ? row("Reference", `•••• ${escapeHtml(sale.paymentReferenceLast4)}`) : ""}
      ${sale.cashReceived !== null ? row("Change", peso(sale.changeDue ?? 0)) : ""}
      ${sale.refundedTotal > 0 && sale.status !== "voided" ? row("Refunded", `−${peso(sale.refundedTotal)}`) : ""}
    </table>
    ${sale.pendingSync ? `<div class="stamp muted">Recorded offline · syncs when online</div>` : ""}
    <div class="rule"></div>
    ${store.receiptFooter ? `<div class="center">${escapeHtml(store.receiptFooter)}</div>` : ""}
    <div class="center muted">This is not an official receipt.</div>`;
  return documentHtml(`Receipt ${sale.orderNumber}`, paperWidth, body);
}

export type RefundReceipt = {
  orderNumber: string;
  kind: "refund" | "void";
  createdAt: Date;
  processedBy: string;
  lines: Line[];
  amount: number;
  method: string;
  reason: string;
  restocked: boolean;
};

export function buildRefundReceipt(store: StoreDetails, refund: RefundReceipt, paperWidth: 58 | 80) {
  const body = `${header(store)}
    <div class="rule"></div>
    <div class="stamp">${refund.kind === "void" ? "VOID" : "REFUND"}</div>
    <div>For receipt ${escapeHtml(refund.orderNumber)}</div>
    <div>${escapeHtml(dateTime(refund.createdAt))}</div>
    <div>Processed by: ${escapeHtml(refund.processedBy)}</div>
    <div class="rule"></div>
    ${linesTable(refund.lines)}
    <div class="rule"></div>
    <table>
      ${row(`Returned by ${methodLabel(refund.method)}`, peso(refund.amount), "total")}
      ${row("Items restocked", refund.restocked ? "Yes" : "No")}
    </table>
    <div class="rule"></div>
    <div>Reason: ${escapeHtml(refund.reason)}</div>
    <div style="margin-top:6mm">Customer signature: ________________</div>`;
  return documentHtml(`${refund.kind === "void" ? "Void" : "Refund"} ${refund.orderNumber}`, paperWidth, body);
}

export type CashCountReport = {
  deviceLabel: string;
  openedBy: string;
  closedBy: string;
  openedAt: Date;
  closedAt: Date;
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  salesCount: number;
  otherSales: { method: string; amount: number }[];
  expected: number;
  counted: number;
  denominations: { label: string; count: number; value: number }[];
  notes: string;
};

export function buildCashCountReport(store: StoreDetails, report: CashCountReport, paperWidth: 58 | 80) {
  const difference = Math.round((report.counted - report.expected) * 100) / 100;
  const body = `${header(store)}
    <div class="rule"></div>
    <div class="center bold">END OF SHIFT · CASH COUNT</div>
    ${report.deviceLabel ? `<div class="center">${escapeHtml(report.deviceLabel)}</div>` : ""}
    <div class="rule"></div>
    <table>
      ${row("Opened", escapeHtml(dateTime(report.openedAt)))}
      ${row("By", escapeHtml(report.openedBy))}
      ${row("Closed", escapeHtml(dateTime(report.closedAt)))}
      ${row("By", escapeHtml(report.closedBy))}
      ${row("Sales", String(report.salesCount))}
    </table>
    <div class="rule"></div>
    <table>
      ${row("Opening cash", peso(report.openingFloat))}
      ${row("+ Cash sales", peso(report.cashSales))}
      ${row("− Cash refunds", peso(report.cashRefunds))}
      ${row("Expected in drawer", peso(report.expected), "bold")}
      ${row("Counted", peso(report.counted), "bold")}
      ${row(difference === 0 ? "Difference" : difference > 0 ? "Over" : "Short", peso(Math.abs(difference)), "total")}
    </table>
    ${report.otherSales.length ? `<div class="rule"></div><table>${report.otherSales.map((item) => row(`${methodLabel(item.method)} sales`, peso(item.amount))).join("")}</table>` : ""}
    <div class="rule"></div>
    <table>${report.denominations.filter((item) => item.count > 0).map((item) => row(`${escapeHtml(item.label)} × ${item.count}`, peso(item.value * item.count))).join("") || row("No cash counted", "")}</table>
    ${report.notes ? `<div class="rule"></div><div>Notes: ${escapeHtml(report.notes)}</div>` : ""}
    <div style="margin-top:6mm">Counted by: ________________</div>
    <div style="margin-top:4mm">Checked by: ________________</div>`;
  return documentHtml("Cash count", paperWidth, body);
}

export const pesoDenominations = [
  { label: "₱1000", value: 1000 },
  { label: "₱500", value: 500 },
  { label: "₱200", value: 200 },
  { label: "₱100", value: 100 },
  { label: "₱50", value: 50 },
  { label: "₱20", value: 20 },
  { label: "₱10", value: 10 },
  { label: "₱5", value: 5 },
  { label: "₱1", value: 1 },
  { label: "₱0.25", value: 0.25 },
];
