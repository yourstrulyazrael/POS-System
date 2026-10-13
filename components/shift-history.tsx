"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Moon, ReceiptText, RefreshCw, Store, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ShiftPeriod = "today" | "7days" | "30days";
type ShiftType = "day" | "night";
type ShiftFilter = "all" | ShiftType;
type ShiftSort = "newest" | "oldest" | "sales" | "orders";
type ShiftOrder = { id: string; createdAt: Date; total: number; paymentMethod: string; items: number };
type Shift = {
  key: string;
  employeeName: string;
  shiftDate: string;
  shiftType: ShiftType;
  start: Date;
  end: Date;
  firstOrderAt: Date;
  lastOrderAt: Date;
  ordersCount: number;
  itemsCount: number;
  salesTotal: number;
  cashTotal: number;
  eWalletTotal: number;
  cardTotal: number;
  orders: ShiftOrder[];
};
type ShiftRow = {
  employee_id: string | null;
  employee_name: string;
  shift_date: string;
  shift_type: ShiftType;
  shift_start: string;
  shift_end: string;
  first_order_at: string;
  last_order_at: string;
  orders_count: number | string;
  items_count: number | string;
  sales_total: number | string;
  cash_total: number | string;
  e_wallet_total: number | string;
  card_total: number | string;
  orders: { id: string; created_at: string; total: number | string; payment_method: string; items: number | string }[];
};

const money = (amount: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const timeOf = (date: Date) =>
  date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
const dateOf = (shiftDate: string) =>
  new Date(`${shiftDate}T12:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" });
const paymentLabel = (method: string) => (method === "e_wallet" ? "E-Wallet" : method === "card" ? "Card" : "Cash");
const periodLabels: Record<ShiftPeriod, string> = { today: "Current business day", "7days": "Last 7 days", "30days": "Last 30 days" };

function parseShift(row: ShiftRow): Shift {
  const shift = {
    key: `${row.employee_id ?? row.employee_name}-${row.shift_date}-${row.shift_type}`,
    employeeName: row.employee_name || "Former employee",
    shiftDate: row.shift_date,
    shiftType: row.shift_type,
    start: new Date(row.shift_start),
    end: new Date(row.shift_end),
    firstOrderAt: new Date(row.first_order_at),
    lastOrderAt: new Date(row.last_order_at),
    ordersCount: Number(row.orders_count),
    itemsCount: Number(row.items_count),
    salesTotal: Number(row.sales_total),
    cashTotal: Number(row.cash_total),
    eWalletTotal: Number(row.e_wallet_total),
    cardTotal: Number(row.card_total),
    orders: (row.orders ?? []).map((order) => ({
      id: `#${order.id.slice(0, 8)}`,
      createdAt: new Date(order.created_at),
      total: Number(order.total),
      paymentMethod: order.payment_method,
      items: Number(order.items),
    })),
  };
  if ([shift.ordersCount, shift.itemsCount, shift.salesTotal, shift.cashTotal, shift.eWalletTotal, shift.cardTotal].some((value) => !Number.isFinite(value))) {
    throw new Error("The shift history returned an invalid numeric value.");
  }
  return shift;
}

export function ShiftHistoryView({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState<ShiftPeriod>("7days");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("all");
  const [sort, setSort] = useState<ShiftSort>("newest");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_shift_history", { p_period: period });
      if (rpcError) {
        if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
          throw new Error("The shift history database function is missing. Apply migration 202610120008_shift_history_and_barcodes.sql, then retry.");
        }
        throw rpcError;
      }
      setShifts((data ?? []).map(parseShift));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load shift history.");
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const employeeNames = useMemo(() => [...new Set(shifts.map((shift) => shift.employeeName))].sort(), [shifts]);
  const visibleShifts = useMemo(() => {
    const filtered = shifts.filter((shift) =>
      (shiftFilter === "all" || shift.shiftType === shiftFilter) &&
      (employeeFilter === "all" || shift.employeeName === employeeFilter),
    );
    const byStart = (a: Shift, b: Shift) => a.start.getTime() - b.start.getTime();
    return filtered.sort((a, b) =>
      sort === "oldest" ? byStart(a, b)
        : sort === "sales" ? b.salesTotal - a.salesTotal || byStart(b, a)
          : sort === "orders" ? b.ordersCount - a.ordersCount || byStart(b, a)
            : byStart(b, a),
    );
  }, [employeeFilter, shiftFilter, shifts, sort]);
  const totals = useMemo(() => {
    const sum = (type: ShiftFilter) => {
      const matching = visibleShifts.filter((shift) => type === "all" || shift.shiftType === type);
      return {
        shifts: matching.length,
        orders: matching.reduce((total, shift) => total + shift.ordersCount, 0),
        sales: matching.reduce((total, shift) => total + shift.salesTotal, 0),
      };
    };
    return { all: sum("all"), day: sum("day"), night: sum("night") };
  }, [visibleShifts]);

  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400"><Store size={14} /> Clover &amp; Co. <span>/</span> <span className="text-blue-600">Shifts</span></div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Shift history</h1>
          <p className="mt-1 text-sm text-slate-500">{isAdmin ? "Orders and sales processed by each employee, per shift." : "Orders and sales you processed, per shift."} Day 6 AM–6 PM · Night 6 PM–6 AM.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Shift history period" value={period} onChange={(event) => { setPeriod(event.target.value as ShiftPeriod); setExpanded(null); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
            <option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
          </select>
          <button type="button" onClick={() => void loadShifts()} disabled={isLoading} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-blue-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"><RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </div>

      {error && <div role="alert" className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="All shifts" icon={null} {...totals.all} />
        <SummaryCard label="Day shifts" icon={<Sun size={15} />} {...totals.day} />
        <SummaryCard label="Night shifts" icon={<Moon size={15} />} {...totals.night} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center">
          <div><h2 className="text-sm font-semibold">Shifts</h2><p className="mt-1 text-xs text-slate-400">{periodLabels[period]} · showing {visibleShifts.length} of {shifts.length}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-50 p-1 dark:bg-slate-800" aria-label="Filter by shift">
              {(["all", "day", "night"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={shiftFilter === option} onClick={() => setShiftFilter(option)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold capitalize ${shiftFilter === option ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-500 hover:text-slate-700"}`}>
                  {option === "day" && <Sun size={12} />}{option === "night" && <Moon size={12} />}{option === "all" ? "All" : option}
                </button>
              ))}
            </div>
            {isAdmin && (
              <select aria-label="Filter by employee" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
                <option value="all">All employees</option>
                {employeeNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
            <select aria-label="Sort shifts" value={sort} onChange={(event) => setSort(event.target.value as ShiftSort)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900">
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="sales">Highest sales</option><option value="orders">Most orders</option>
            </select>
          </div>
        </div>

        {isLoading && shifts.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading shifts…</div>
        ) : visibleShifts.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">{shifts.length ? "No shifts match these filters." : "No orders were processed in this period."}</div>
        ) : (
          <ul className={`divide-y divide-slate-100 dark:divide-slate-800 ${isLoading ? "opacity-60" : ""}`}>
            {visibleShifts.map((shift) => {
              const isOpen = expanded === shift.key;
              return (
                <li key={shift.key}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : shift.key)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${shift.shiftType === "day" ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"}`}>
                      {shift.shiftType === "day" ? <Sun size={18} /> : <Moon size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{shift.employeeName}</span>
                      <span className="mt-1 block text-xs text-slate-400">{dateOf(shift.shiftDate)} · <span className="capitalize">{shift.shiftType}</span> shift · {timeOf(shift.start)}–{timeOf(shift.end)}</span>
                      <span className="mt-1 block text-[11px] text-slate-500">First sale {timeOf(shift.firstOrderAt)} · last sale {timeOf(shift.lastOrderAt)}</span>
                    </span>
                    <span className="hidden text-right text-xs text-slate-500 sm:block">
                      <span className="block font-medium text-slate-700 dark:text-slate-200">{shift.ordersCount} order{shift.ordersCount === 1 ? "" : "s"}</span>
                      <span className="mt-1 block">{shift.itemsCount} item{shift.itemsCount === 1 ? "" : "s"}</span>
                    </span>
                    <span className="w-28 text-right">
                      <span className="block font-mono text-sm font-semibold">{money(shift.salesTotal)}</span>
                      <span className="mt-1 block text-[10px] text-slate-400 sm:hidden">{shift.ordersCount} orders</span>
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
                        <span>Cash <b className="font-mono font-semibold text-slate-700 dark:text-slate-200">{money(shift.cashTotal)}</b></span>
                        <span>E-Wallet <b className="font-mono font-semibold text-slate-700 dark:text-slate-200">{money(shift.eWalletTotal)}</b></span>
                        <span>Card <b className="font-mono font-semibold text-slate-700 dark:text-slate-200">{money(shift.cardTotal)}</b></span>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <table className="w-full min-w-[480px] text-left text-xs">
                          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800"><tr><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Time</th><th className="px-4 py-2.5">Payment</th><th className="px-4 py-2.5 text-right">Items</th><th className="px-4 py-2.5 text-right">Total</th></tr></thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {shift.orders.map((order) => (
                              <tr key={order.id + order.createdAt.getTime()}>
                                <td className="px-4 py-2.5 font-medium"><ReceiptText size={12} className="mr-1.5 inline text-slate-400" />{order.id}</td>
                                <td className="px-4 py-2.5 text-slate-500">{timeOf(order.createdAt)}</td>
                                <td className="px-4 py-2.5 text-slate-500">{paymentLabel(order.paymentMethod)}</td>
                                <td className="px-4 py-2.5 text-right">{order.items}</td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold">{money(order.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CashCountsPanel isAdmin={isAdmin} />
    </section>
  );
}

function SummaryCard({ label, icon, shifts, orders, sales }: { label: string; icon: ReactNode; shifts: number; orders: number; sales: number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{money(sales)}</p>
      <p className="mt-1 text-[10px] text-slate-400">{shifts} shift{shifts === 1 ? "" : "s"} · {orders} order{orders === 1 ? "" : "s"}</p>
    </div>
  );
}

type CashCountRow = {
  id: string;
  device_label: string;
  opened_by_name: string;
  closed_by_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number | string;
  counted_cash: number | string | null;
  expected_cash: number | string | null;
  server_expected_cash: number | string | null;
  notes: string;
};

// End-of-shift cash counts synced from the tills. "Expected" is the till's own
// figure; the database's check (from synced cash sales and refunds) is shown
// when it differs, e.g. while offline sales from that shift are still syncing.
function CashCountsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<CashCountRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void createClient()
      .from("cash_sessions")
      .select("id, device_label, opened_by_name, closed_by_name, opened_at, closed_at, opening_float, counted_cash, expected_cash, server_expected_cash, notes")
      .order("opened_at", { ascending: false })
      .limit(60)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(/relation|schema cache|does not exist/i.test(loadError.message) ? "Cash counts need the latest database update (migration 202610120013)." : `Couldn’t load cash counts: ${loadError.message}`);
        else setRows((data ?? []) as CashCountRow[]);
      });
  }, []);

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold">Cash counts</h2>
        <p className="mt-1 text-xs text-slate-400">{isAdmin ? "End-of-shift drawer counts from every till." : "Your end-of-shift drawer counts."} Over and short compare the counted cash with what the drawer should hold.</p>
      </div>
      {error ? <p className="px-5 py-6 text-sm text-slate-500">{error}</p> : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No drawer sessions yet. Start one from the wallet icon in the top bar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-slate-800"><tr><th className="px-5 py-3">Shift</th><th className="px-4 py-3">Till</th><th className="px-4 py-3 text-right">Opening</th><th className="px-4 py-3 text-right">Expected</th><th className="px-4 py-3 text-right">Counted</th><th className="px-4 py-3 text-right">Over / short</th><th className="px-5 py-3">Notes</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => {
                const opened = new Date(row.opened_at);
                const expected = row.expected_cash === null ? null : Number(row.expected_cash);
                const serverExpected = row.server_expected_cash === null ? null : Number(row.server_expected_cash);
                const counted = row.counted_cash === null ? null : Number(row.counted_cash);
                const difference = counted !== null && expected !== null ? Math.round((counted - expected) * 100) / 100 : null;
                return (
                  <tr key={row.id}>
                    <td className="px-5 py-3"><p className="font-medium">{opened.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" })}</p><p className="mt-0.5 text-[11px] text-slate-400">{row.closed_at ? `Closed ${timeOf(new Date(row.closed_at))} by ${row.closed_by_name || row.opened_by_name}` : `Open · ${row.opened_by_name}`}</p></td>
                    <td className="px-4 py-3 text-slate-500">{row.device_label || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(Number(row.opening_float))}</td>
                    <td className="px-4 py-3 text-right font-mono">{expected === null ? "—" : money(expected)}{serverExpected !== null && expected !== null && Math.abs(serverExpected - expected) >= 0.01 && <span className="block text-[10px] text-amber-600" title="Computed by the database from synced cash sales and refunds">DB: {money(serverExpected)}</span>}</td>
                    <td className="px-4 py-3 text-right font-mono">{counted === null ? "—" : money(counted)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${difference === null ? "text-slate-400" : difference === 0 ? "text-emerald-600" : difference > 0 ? "text-amber-600" : "text-red-600"}`}>{difference === null ? "—" : difference === 0 ? "Balanced" : `${difference > 0 ? "Over" : "Short"} ${money(Math.abs(difference))}`}</td>
                    <td className="max-w-[200px] truncate px-5 py-3 text-slate-500" title={row.notes}>{row.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
