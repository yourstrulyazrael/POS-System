"use client";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { ArrowLeft, Coffee, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export function AdminSetupForm() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/setup-admin")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to check admin setup.");
        setAvailable(data.available);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to check admin setup.");
        setAvailable(false);
      });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formData.get("fullName"),
          email: formData.get("email"),
          password: formData.get("password"),
          setupSecret: formData.get("setupSecret"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create the admin account.");
      window.location.assign("/auth/login?admin-created=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the admin account.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f8ff] px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="fixed right-4 top-4"><ThemeSwitcher /></div>
      <section className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-7 shadow-xl shadow-blue-900/5 dark:border-slate-800 dark:bg-slate-900 sm:p-9">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white"><Coffee size={23} /></div>
        <p className="text-xs font-bold tracking-widest text-blue-600">CLOVER &amp; CO.</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set up your store admin</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Create the first administrator. This one-time setup closes automatically after an admin account exists.</p>

        {available === null ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin" /> Checking store setup…</div>
        ) : available ? (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block text-sm font-medium text-slate-700">Full name<input required maxLength={100} name="fullName" autoComplete="name" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
            <label className="block text-sm font-medium text-slate-700">Admin email<input required type="email" name="email" autoComplete="email" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></label>
            <label className="block text-sm font-medium text-slate-700">Password<input required minLength={8} type="password" name="password" autoComplete="new-password" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /><span className="mt-1 block text-xs font-normal text-slate-400">Use at least 8 characters.</span></label>
            <label className="block text-sm font-medium text-slate-700">One-time setup key<input required type="password" name="setupSecret" autoComplete="off" className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /><span className="mt-1 block text-xs font-normal text-slate-400">This must match POS_SETUP_SECRET in your server environment.</span></label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button disabled={isSaving} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"><ShieldCheck size={16} />{isSaving ? "Creating account…" : "Create first admin"}</button>
          </form>
        ) : (
          <div className="mt-6 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{error || "An admin account already exists. Ask an administrator to create your account."}</div>
        )}

        <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-700"><ArrowLeft size={15} /> Back to sign in</Link>
      </section>
    </main>
  );
}
