"use client";

// "Connect to your store": links this device to a store's database, with the
// store code you were given or the project URL and publishable key. Changing
// to another store first makes sure nothing is waiting to sync, then clears
// the previous store's data from this computer.
import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Link2, Store, TriangleAlert } from "lucide-react";
import { readCurrentSession, readSessionOutbox } from "@/lib/cash-session";
import { eraseOfflineData, listPendingOrders } from "@/lib/offline-store";
import { connectionProblem, parseStoreCode, projectRef, saveStoreConnection, testStoreConnection, type StoreConnection } from "@/lib/store-connection";
import { AUTH_STORAGE_KEY } from "@/lib/supabase/client";

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-950";

export function ConnectStoreScreen({ current, onCancel }: { current: StoreConnection | null; onCancel?: () => void }) {
  const [mode, setMode] = useState<"code" | "manual">("code");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Switching stores erases this computer's data for the current one, so it
  // takes a second, explicit confirmation.
  const [pending, setPending] = useState<StoreConnection | null>(null);

  function readForm(): StoreConnection {
    if (mode === "code") return parseStoreCode(code);
    const connection = { name: name.trim().slice(0, 80), url: url.trim().replace(/\/+$/, ""), key: key.trim() };
    const problem = connectionProblem(connection);
    if (problem) throw new Error(problem);
    return connection;
  }

  async function connect(connection: StoreConnection) {
    if (current && current.url !== connection.url) {
      const [orders, outbox, session] = await Promise.all([listPendingOrders(), readSessionOutbox(), readCurrentSession()]);
      if (orders.length) throw new Error(`${orders.length} sale${orders.length === 1 ? " is" : "s are"} still waiting to sync. Sign in to ${current.name || "the current store"} and let ${orders.length === 1 ? "it" : "them"} sync first.`);
      if (session && !session.closed) throw new Error("A cash drawer shift is still open on this computer. Sign in, count the drawer and close the shift first.");
      if (outbox.length) throw new Error("A drawer count is still waiting to sync. Sign in and let it sync first.");
      await eraseOfflineData();
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    saveStoreConnection(connection);
    window.location.replace(window.location.pathname);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const connection = pending ?? readForm();
      if (!pending) {
        await testStoreConnection(connection);
        if (current && current.url !== connection.url) {
          setPending(connection);
          return;
        }
      }
      await connect(connection);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn’t connect to the store.");
    } finally {
      setBusy(false);
    }
  }

  const tab = (value: "code" | "manual", label: string, Icon: typeof KeyRound) => (
    <button type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setError(""); setPending(null); }} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${mode === value ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}><Icon size={14} />{label}</button>
  );

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f8ff] px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-[460px]">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white"><Store size={20} /></span>
          <div><p className="text-sm font-semibold">Clover &amp; Co. POS</p><p className="text-xs text-slate-500">Point of sale</p></div>
        </div>
        <p className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-400">{current ? "CHANGE STORE" : "FIRST-TIME SETUP"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Connect to your store</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {current
            ? <>Enter another store’s code to switch this computer from <b className="font-semibold text-slate-700 dark:text-slate-200">{current.name || projectRef(current.url)}</b></>
            : "Enter the store code you were given. You only need to do this once on each computer."}
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="How to connect">
            {tab("code", "Store code", KeyRound)}
            {tab("manual", "Project details", Link2)}
          </div>
          {mode === "code" ? (
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Store code
              <textarea autoFocus required rows={3} value={code} onChange={(event) => { setCode(event.currentTarget.value); setPending(null); }} spellCheck={false} placeholder="CLOVER1-…" className={`${inputClass} resize-none py-3 font-mono text-xs`} />
            </label>
          ) : (
            <>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Store name <span className="font-normal text-slate-400">(shown on this screen)</span>
                <input value={name} maxLength={80} onChange={(event) => setName(event.currentTarget.value)} placeholder="e.g. Juan’s Sari-Sari Store" className={`${inputClass} h-12`} />
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Project URL
                <input required type="url" value={url} onChange={(event) => { setUrl(event.currentTarget.value); setPending(null); }} spellCheck={false} placeholder="https://abcdefghijklmnop.supabase.co" className={`${inputClass} h-12 font-mono text-xs`} />
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Publishable key
                <input required value={key} onChange={(event) => { setKey(event.currentTarget.value); setPending(null); }} spellCheck={false} autoComplete="off" placeholder="sb_publishable_…" className={`${inputClass} h-12 font-mono text-xs`} />
                <span className="mt-1 block text-[11px] font-normal text-slate-400">Supabase → Project Settings → API Keys. Never use a secret key here.</span>
              </label>
            </>
          )}

          {pending && current && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>Switch to <b>{pending.name || projectRef(pending.url)}</b>? This computer’s saved data for {current.name || "the current store"} (offline sign-in, cached products, saved orders) will be removed. Sales already synced stay safe in that store’s database.</span>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button disabled={busy} type="submit" className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-lg transition disabled:opacity-60 ${pending ? "bg-amber-600 shadow-amber-600/20 hover:bg-amber-700" : "bg-blue-600 shadow-blue-600/20 hover:bg-blue-700"}`}>
            {busy ? "Checking…" : pending ? "Yes, switch stores" : <>Connect <ArrowRight size={17} /></>}
          </button>
          {onCancel && <button type="button" onClick={onCancel} className="h-10 w-full rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>}
        </form>
        <p className="mt-8 text-center text-xs leading-5 text-slate-400">Don’t have a store code? Ask whoever set up your POS service.</p>
      </div>
    </main>
  );
}
