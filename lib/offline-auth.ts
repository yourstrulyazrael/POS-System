// Offline sign-in for people who have signed in online on this device before.
//
// After each successful online sign-in we store a password verifier: PBKDF2-
// SHA256 (310,000 iterations, random 16-byte salt) of the password. The
// password itself is never stored. Offline, the typed password is checked
// against it. Verifiers expire 30 days after the last online sign-in, so a
// changed password or a removed account stops working offline within that
// window, and immediately once the till is back online.
import { readCache, writeCache } from "@/lib/offline-store";

const ITERATIONS = 310_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const key = (email: string) => `credential:${email.trim().toLowerCase()}`;

type StoredCredential = {
  userId: string;
  email: string;
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  savedAt: number;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, 256);
  return new Uint8Array(bits);
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function rememberOfflineCredential(userId: string, email: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  const credential: StoredCredential = { userId, email: email.trim().toLowerCase(), salt: toBase64(salt), hash: toBase64(hash), iterations: ITERATIONS, savedAt: Date.now() };
  await writeCache(key(email), credential);
}

// Returns the user id if the password matches a recent online sign-in on
// this device; otherwise explains why offline sign-in isn't possible.
export async function verifyOfflineCredential(email: string, password: string): Promise<{ userId: string } | { error: string }> {
  const credential = await readCache<StoredCredential>(key(email));
  if (!credential) {
    return { error: "You’re offline, and this account hasn’t signed in on this computer before. Connect to the internet to sign in." };
  }
  if (Date.now() - credential.savedAt > MAX_AGE_MS) {
    return { error: "You’re offline, and it’s been more than 30 days since this account signed in online here. Connect to the internet to sign in." };
  }
  const hash = await derive(password, fromBase64(credential.salt), credential.iterations);
  if (!sameBytes(hash, fromBase64(credential.hash))) {
    return { error: "Incorrect email or password." };
  }
  return { userId: credential.userId };
}

export async function forgetOfflineCredential(email: string) {
  await writeCache(key(email), null);
}
