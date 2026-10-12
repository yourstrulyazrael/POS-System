"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Printer, RefreshCw } from "lucide-react";
import { SmoothLineChart } from "@/components/smooth-line-chart";

type ReportPeriod = "today" | "7days" | "30days";
type ReportBucket = {
  label: string;
  revenue: number;
  costOfGoods: number;
  netProfit: number;
  orderCount: number;
  ordersWithCost: number;
  ordersWithoutCost: number;
};

const periodLabels: Record<ReportPeriod, string> = {
  today: "Today",
  "7days": "Last 7 days",
  "30days": "Last 30 days",
};

const money = (amount: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);

export function AnalyticsReportsView({
  period,
  onPeriodChange,
  rows,
  isLoading,
  error,
  lastUpdated,
  onRefresh,
}: {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  rows: ReportBucket[];
  isLoading: boolean;
  error: string;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const [exportError, setExportError] = useState("");

  const totals = useMemo(
    () => rows.reduce(
      (current, row) => ({
        revenue: current.revenue + row.revenue,
        costOfGoods: current.costOfGoods + row.costOfGoods,
        netProfit: current.netProfit + row.netProfit,
        orderCount: current.orderCount + row.orderCount,
        ordersWithCost: current.ordersWithCost + row.ordersWithCost,
        ordersWithoutCost: current.ordersWithoutCost + row.ordersWithoutCost,
      }),
      { revenue: 0, costOfGoods: 0, netProfit: 0, orderCount: 0, ordersWithCost: 0, ordersWithoutCost: 0 },
    ),
    [rows],
  );
  function exportExcel() {
    setExportError("");
    try {
      const summaryRows: (string | number)[][] = [
        ["Analytics & Reports", periodLabels[period]],
        ["Generated", new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })],
        [""],
        ["Revenue", totals.revenue],
        ["Cost of goods sold (known costs)", totals.costOfGoods],
        ["Estimated net profit", totals.netProfit],
        ["Orders", totals.orderCount],
        ["Orders with cost records", totals.ordersWithCost],
        ["Orders missing cost records", totals.ordersWithoutCost],
        [""],
        ["Note", "Estimated net profit is revenue less recorded product cost and excludes operating expenses. Orders without cost snapshots are excluded from net profit."],
      ];
      const breakdownRows: (string | number)[][] = [
        ["Period", "Revenue", "Cost of goods (known costs)", "Estimated net profit", "Orders", "Orders with cost records", "Orders missing cost records"],
        ...rows.map((row) => [
          row.label,
          row.revenue,
          row.costOfGoods,
          row.netProfit,
          row.orderCount,
          row.ordersWithCost,
          row.ordersWithoutCost,
        ]),
      ];
      const xmlEscape = (value: string) => value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
      const worksheet = (name: string, data: (string | number)[][]) =>
        `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${data.map((row) =>
          `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${typeof cell === "number" ? cell : xmlEscape(cell)}</Data></Cell>`).join("")}</Row>`,
        ).join("")}</Table></Worksheet>`;
      const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheet("Summary", summaryRows)}
${worksheet("Breakdown", breakdownRows)}
</Workbook>`;
      const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `analytics-${period}-${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caughtError) {
      setExportError(caughtError instanceof Error ? `Unable to export Excel report: ${caughtError.message}` : "Unable to export Excel report.");
    }
  }

  function exportPdf() {
    window.print();
  }

  return (
    <section>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><span>Reports</span><span>/</span><span className="text-blue-600">Analytics</span></div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Analytics &amp; Reports</h1>
            <p className="mt-1 text-sm text-slate-500">Revenue and estimated profit · PHP · Asia/Manila</p>
          </div>
          <div className="analytics-no-print flex flex-wrap items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={isLoading} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh</button>
            <button type="button" onClick={exportPdf} disabled={isLoading || rows.length === 0} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><Printer size={14} /> Export PDF</button>
            <button type="button" onClick={exportExcel} disabled={isLoading || rows.length === 0} className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><FileSpreadsheet size={14} /> Export Excel</button>
          </div>
        </header>

        <div className="analytics-print-card rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Reports <span className="px-1">/</span> <span className="text-blue-600">{periodLabels[period]}</span></p>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{periodLabels[period]} performance</h2>
              <p className="mt-1 text-sm text-slate-500">Revenue and estimated profit · PHP · Asia/Manila</p>
            </div>
            <div className="analytics-no-print flex items-center gap-2">
              <label htmlFor="report-period" className="text-xs font-medium text-slate-500">Date range</label>
              <select id="report-period" value={period} onChange={(event) => onPeriodChange(event.target.value as ReportPeriod)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
                <option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
              </select>
            </div>
          </div>

          {(error || exportError) && <div role="alert" className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error || exportError}</div>}
          {totals.ordersWithoutCost > 0 && (
            <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              Estimated net profit uses only orders with recorded product costs. {totals.ordersWithoutCost} order{totals.ordersWithoutCost === 1 ? " is" : "s are"} missing cost snapshots and excluded from the profit calculation. This estimate also excludes operating expenses.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Revenue" value={money(totals.revenue)} detail={`${totals.orderCount} completed orders`} accent="blue" />
            <MetricCard label="Estimated net profit" value={money(totals.netProfit)} detail={`${totals.ordersWithCost} orders with recorded costs`} accent="emerald" />
            <MetricCard label="Cost of goods sold" value={money(totals.costOfGoods)} detail="Orders with recorded costs" accent="violet" />
            <MetricCard label="Orders missing cost" value={String(totals.ordersWithoutCost)} detail="Excluded from profit estimate" accent="amber" />
          </div>

          <div className="mt-7">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold">Revenue by {period === "today" ? "hour" : "day"}</h3><p className="mt-1 text-xs text-slate-400">Revenue for all recorded orders in each period</p></div>
              <p className="analytics-no-print text-[11px] text-slate-400">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}` : ""}</p>
            </div>
            {isLoading ? (
              <div className="grid h-52 place-items-center rounded-xl bg-slate-50 text-sm text-slate-400 dark:bg-slate-800">Loading report…</div>
            ) : (
              <div className="rounded-xl bg-slate-50 px-3 py-4 dark:bg-slate-800 sm:px-5">
                <SmoothLineChart
                  labels={rows.map((row) => row.label)}
                  series={[
                    { name: "Revenue", color: "#3b82f6", values: rows.map((row) => row.revenue) },
                    { name: "Estimated net profit", color: "#10b981", values: rows.map((row) => row.netProfit) },
                  ]}
                  valueFormat={money}
                />
              </div>
            )}
            <div className="mt-2 flex gap-4 text-[10px] text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />Revenue</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Estimated net profit</span></div>
          </div>

          <div className="mt-7 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><h3 className="text-sm font-semibold">Period breakdown</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800"><tr><th className="px-4 py-3">{period === "today" ? "Hour" : "Date"}</th><th className="px-4 py-3 text-right">Revenue</th><th className="px-4 py-3 text-right">Cost of goods</th><th className="px-4 py-3 text-right">Estimated profit</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Missing cost</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((row) => <tr key={row.label}><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3 text-right">{money(row.revenue)}</td><td className="px-4 py-3 text-right">{money(row.costOfGoods)}</td><td className="px-4 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">{money(row.netProfit)}</td><td className="px-4 py-3 text-right">{row.orderCount}</td><td className="px-4 py-3 text-right">{row.ordersWithoutCost}</td></tr>)}
                  {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No report data for this period.</td></tr>}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold dark:bg-slate-800"><tr><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{money(totals.revenue)}</td><td className="px-4 py-3 text-right">{money(totals.costOfGoods)}</td><td className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">{money(totals.netProfit)}</td><td className="px-4 py-3 text-right">{totals.orderCount}</td><td className="px-4 py-3 text-right">{totals.ordersWithoutCost}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-slate-400">Estimated net profit = revenue less recorded cost of goods sold. It is not accounting net income and excludes rent, payroll, taxes, and other operating expenses. Orders without cost snapshots are excluded from cost and profit totals.</p>
        </div>
    </section>
  );
}

function MetricCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: "blue" | "emerald" | "violet" | "amber" }) {
  const accents = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  };
  return (
    <div className="analytics-print-card rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex rounded-lg px-2.5 py-1 text-[10px] font-semibold ${accents[accent]}`}>{label}</span>
      <p className="mt-3 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] text-slate-400">{detail}</p>
    </div>
  );
}
