// Makes the store code a client enters on each till ("Connect to your
// store"). The code only holds the store name, the Supabase project URL and
// its publishable key, which are safe to share with the store: what each
// user can do is enforced by the database's security rules.
//
//   npm run store:code -- --name "Juan's Store" --url https://abcd.supabase.co --key sb_publishable_...
//
// The app checks codes the same way (lib/store-connection.ts).

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const name = (option("name") ?? "").trim().slice(0, 80);
const url = (option("url") ?? "").trim().replace(/\/+$/, "");
const key = (option("key") ?? "").trim();

function fail(message) {
  console.error(`\n  ${message}\n\n  Usage: npm run store:code -- --name "Store name" --url https://<project-ref>.supabase.co --key sb_publishable_...\n`);
  process.exit(1);
}

if (!url || !key) fail("Both --url and --key are required.");
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("--url isn't a valid URL.");
}
if (parsed.protocol !== "https:" || parsed.pathname !== "/") fail("--url must be the project URL only, e.g. https://abcdefghijklmnop.supabase.co");
if (key.startsWith("sb_secret_")) fail("That's a SECRET key. Use the publishable key (sb_publishable_...). Never give a secret key to a store.");
if (!key.startsWith("sb_publishable_")) {
  let role;
  try {
    role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role;
  } catch {
    // Not a JWT.
  }
  if (role === "service_role") fail("That's the SERVICE ROLE key. Use the anon / publishable key. Never give a service role key to a store.");
  if (role !== "anon") fail("--key should be the project's publishable key (sb_publishable_...).");
}

// Check the key against the project before handing out the code.
try {
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (!response.ok) fail(`The project rejected the key (HTTP ${response.status}). Check --url and --key.`);
} catch (error) {
  if (error?.code === "ERR_INVALID_URL") throw error;
  console.warn("  (Couldn't reach the project to check the key; the code was still made.)");
}

const code = `CLOVER1-${Buffer.from(JSON.stringify({ n: name, u: url, k: key })).toString("base64url")}`;
console.log(`\n  Store code for ${name || parsed.hostname}:\n\n  ${code}\n\n  On each till: open the POS → "Connect to your store" (or "Change store" on the sign-in screen) → paste the code.\n`);
