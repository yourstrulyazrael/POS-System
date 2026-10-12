# Clover POS

Point-of-sale desktop app for Clover & Co. — checkout with barcode scanning, inventory with Excel import/export, wholesale pricing, shifts, and sales reports.

It's a Next.js app built as a **static export** and packaged with **Electron**. There is no app server: all data lives in **Supabase**, protected by row-level security, database functions, and one Edge Function (`pos-admin`) for account management. The installer contains only the public Supabase key. The app needs an internet connection to reach Supabase.

## 1. Set up Supabase (once)

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>

# Database: tables, policies and functions (supabase/migrations)
supabase db push

# Edge Function for creating/removing employees, setting their passwords,
# and the one-time first-admin setup
supabase functions deploy pos-admin --no-verify-jwt
supabase secrets set POS_SETUP_SECRET=<a long random value>
```

`--no-verify-jwt` is required: the function checks the signed-in user itself, because the app uses a publishable key (not a JWT) and first-admin setup runs before anyone can sign in.

## 2. Configure the app

Create `.env.local` with the **public** values only (Supabase dashboard → Project Settings → API):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

These are compiled into the app. Never put the service-role / secret key in `.env.local`: the app doesn't use it, and anything there could end up in a build.

## 3. Develop

```bash
npm install
npx install-electron     # downloads the Electron runtime (first time only)
npm run dev              # web UI at http://localhost:3000
npm run desktop:dev      # Electron window pointed at the dev server (run alongside npm run dev)
npm run desktop          # build the static export and open it in Electron
npm run lint
```

> Running from VS Code's terminal? It sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron behave like plain Node. Clear it first (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`; bash: `unset ELECTRON_RUN_AS_NODE`).

## 4. Build the Windows installer

```bash
npm run dist:win
```

Output: `dist-desktop/Clover POS Setup <version>.exe` (≈115 MB, mostly the Electron runtime). Bump `version` in `package.json` for each release. The installer is unsigned, so Windows SmartScreen will warn on first run; configure a code-signing certificate in electron-builder to remove the warning.

## 5. First run

1. Open the app → **Create the first admin**, and enter the `POS_SETUP_SECRET` value. Setup closes once an admin exists.
2. Sign in, then add products (Inventory → **Import products** accepts the Excel template) and employees (Employees → **Add employee**).
3. Forgotten employee passwords: Employees → **Set password**. A forgotten admin password: Supabase dashboard → Authentication → Users.

## Offline mode

If the connection drops, a cashier who is already signed in can keep selling:

- The POS opens from the products, orders and profile last loaded on this computer (cached in IndexedDB per user).
- Each sale is written to disk (IndexedDB, strict durability) before the cart clears, then synced automatically when Supabase is reachable again — on reconnect, at sign-in, and every 30 s while sales are waiting. The cloud icon in the top bar shows the queue; click it for details or **Sync now**.
- Every sale carries a one-time id (`orders.client_order_id`), so a retry after a dropped connection or a repeated sync is never recorded twice. A sale leaves the queue only after Supabase confirms it; a sale the server refuses is kept and marked failed, never deleted.
- Synced sales keep their original time, cashier and the prices actually charged. If offline sales sold more than the recorded stock, stock stops at 0 and the product appears under **Recount needed** in Inventory (`stock_shortfalls`).
- Online-only: signing in, inventory/employee/account changes, imports, analytics and shift reports.

Anyone who signed in online on a computer in the last 30 days can also **sign in offline** there: the app stores a PBKDF2 password verifier (never the password). Once back online, a blue bar asks for the password once to reconnect and sync.

## Refunds, receipts, cash drawer

- **Voids and refunds** (Orders → ⋮): a void cancels a whole sale and restocks it (the cashier within 30 minutes, admins any time); a refund returns some or all items, optionally restocked, by cash, e-wallet or card (admins). Reports show sales after refunds. Online only.
- **Receipts**: 58 mm or 80 mm thermal receipts for sales, refunds/voids and the end-of-shift report. Set the printer per computer in Account → Receipts & cash drawer; admins set the store name, address and footer (store_settings). The desktop app prints silently; the browser uses the print dialog.
- **Cash drawer**: opened by the printer driver, or directly by the desktop app via a network ESC/POS printer (port 9100) or a shared Windows printer.
- **End-of-shift cash count**: start a shift with the opening cash (wallet icon), close it by counting notes and coins. The till shows expected vs counted (over/short) and prints the report; the count syncs to Shifts → Cash counts, where the database's own expected-cash check is shown too. Works offline.

## Project layout

| Path | What it is |
|---|---|
| `app/page.tsx` | The POS app (sign-in, POS, inventory, orders, shifts, reports, settings) |
| `components/` | Analytics, shift history, chart, setup form, UI primitives |
| `lib/supabase/client.ts` | Supabase client (session stored locally) and the `pos-admin` caller |
| `lib/product-import.ts` | Excel/CSV/JSON import parsing and `.xlsx` template/export writing |
| `lib/offline-store.ts` | IndexedDB queue of offline sales and the offline workspace cache |
| `lib/offline-auth.ts` | Offline sign-in password verifiers (PBKDF2) |
| `lib/cash-session.ts` | Cash drawer sessions (end-of-shift count), offline-first |
| `lib/receipts.ts`, `lib/hardware.ts` | Receipt layouts; printer and cash drawer access |
| `components/pos-dialogs.tsx` | Refund/void, cash drawer, reconnect and hardware-settings UI |
| `electron/preload.cjs` | Narrow printing/drawer bridge exposed to the page |
| `supabase/migrations/` | Database schema, row-level security and functions |
| `supabase/functions/pos-admin/` | Edge Function for account management |
| `electron/main.cjs` | Desktop shell: serves `out/` over `app://`, sandboxed window, CSP |
| `build/icon.png` | App icon used for the installer |
