// Cash drawer sessions (end-of-shift cash count), kept on the till so they
// work offline. Opening and closing are queued in an outbox and synced to
// Supabase (sync_cash_session), like offline sales.
import { readCache, writeCache } from "@/lib/offline-store";

export type CashSession = {
  id: string;
  openedBy: string;
  openedByName: string;
  deviceLabel: string;
  openedAt: string;
  openingFloat: number;
  // Running totals on this till, so expected cash is known offline.
  cashSales: number;
  cashRefunds: number;
  salesCount: number;
  otherSales: Record<string, number>; // e_wallet / card totals
  closed: null | {
    closedBy: string;
    closedByName: string;
    closedAt: string;
    countedCash: number;
    expectedCash: number;
    denominations: Record<string, number>;
    notes: string;
  };
};

const CURRENT = "cashSession:current";
const OUTBOX = "cashSession:outbox";
const round = (value: number) => Math.round(value * 100) / 100;

export async function readCurrentSession() {
  return (await readCache<CashSession | null>(CURRENT)) ?? null;
}

async function queue(session: CashSession) {
  const outbox = (await readCache<CashSession[]>(OUTBOX)) ?? [];
  await writeCache(OUTBOX, [...outbox.filter((item) => item.id !== session.id), session]);
}

export async function readSessionOutbox() {
  return (await readCache<CashSession[]>(OUTBOX)) ?? [];
}

export async function removeFromSessionOutbox(id: string) {
  const outbox = (await readCache<CashSession[]>(OUTBOX)) ?? [];
  await writeCache(OUTBOX, outbox.filter((item) => item.id !== id));
}

export async function openSession(input: { openedBy: string; openedByName: string; deviceLabel: string; openingFloat: number }) {
  const session: CashSession = {
    id: crypto.randomUUID(),
    ...input,
    openingFloat: round(input.openingFloat),
    openedAt: new Date().toISOString(),
    cashSales: 0,
    cashRefunds: 0,
    salesCount: 0,
    otherSales: {},
    closed: null,
  };
  await writeCache(CURRENT, session);
  await queue(session);
  return session;
}

export const expectedCash = (session: CashSession) => round(session.openingFloat + session.cashSales - session.cashRefunds);

// Adds a sale (positive) or a refund/void (negative amount) to the open session.
export async function recordInSession(sessionId: string, method: string, amount: number, isSale: boolean) {
  const session = await readCurrentSession();
  if (!session || session.id !== sessionId) return session;
  const updated: CashSession = { ...session, otherSales: { ...session.otherSales } };
  if (isSale) updated.salesCount += 1;
  if (method === "cash") {
    if (amount >= 0) updated.cashSales = round(updated.cashSales + amount);
    else updated.cashRefunds = round(updated.cashRefunds - amount);
  } else {
    updated.otherSales[method] = round((updated.otherSales[method] ?? 0) + amount);
  }
  await writeCache(CURRENT, updated);
  return updated;
}

export async function closeSession(session: CashSession, close: NonNullable<CashSession["closed"]>) {
  const closed: CashSession = { ...session, closed: { ...close, countedCash: round(close.countedCash), expectedCash: round(close.expectedCash) } };
  await queue(closed);
  await writeCache(CURRENT, null);
  return closed;
}
