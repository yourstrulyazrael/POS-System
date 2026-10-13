# Setting up a new client store

Each client store has its own Supabase project (its own database). All stores
use the same app and installer; a till is pointed at its store with a
**store code**.

## 1. Create the store's Supabase project

1. In the Supabase dashboard, create a new project (paid plan for real clients:
   free projects pause when idle). Pick the region closest to the store
   (e.g. Singapore).
2. Note the **project ref** (in the URL, e.g. `abcdefghijklmnop`) and the
   **publishable key** (Project Settings → API Keys, starts with
   `sb_publishable_`). Never give a store the secret / service role key.

## 2. Set up its database and admin function

From this repository:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy pos-admin --no-verify-jwt
npx supabase secrets set POS_SETUP_SECRET=<long random value for this store>
```

`supabase link` switches which project the CLI talks to. Afterwards, link back
to your own store's project before running `db push` for it.

## 3. Make the store code

```sh
npm run store:code -- --name "Store name" --url https://<project-ref>.supabase.co --key sb_publishable_...
```

This checks the key and prints a `CLOVER1-…` code. It contains only the
store name, URL and publishable key, so it's safe to give to the store.

## 4. Set up the store's tills

1. Install the POS (`Clover-POS-Setup-x.y.z.exe`).
2. On the sign-in screen, click **Change store** (or, on a build without a
   built-in store, the **Connect to your store** screen appears by itself) and
   paste the store code.
3. Create the store's first admin: **Create the first admin** on the sign-in
   screen, using the `POS_SETUP_SECRET` from step 2. The setup page shows
   which store you're creating it for.
4. The admin then adds employees and products (Inventory → Import products).

Each till only needs the code once; it's remembered, also offline.
Switching a till to another store is refused while sales or a drawer count
are still waiting to sync, and it clears the previous store's data from that
computer.

## 5. Every app update

Database changes must reach **every** store before the app update that needs
them is published. For each store's project:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Then publish the release on the public releases repository,
https://github.com/yourstrulyazrael/POS-System-Releases (tag `vX.Y.Z`, with the
`.exe`, `.exe.blockmap` and `latest.yml` from `dist-desktop`). The source code
repository is private; installed apps only read the releases repository. Keep
database changes backward compatible: tills update at different times.

## Built-in store

Builds made with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(and optionally `NEXT_PUBLIC_STORE_NAME`) in `.env.local` connect to that store
by default, and each till saves it on first run. Once every existing till has
run a version with store codes (1.1.6 or later), you can build without those
values: new tills then always show **Connect to your store**.
