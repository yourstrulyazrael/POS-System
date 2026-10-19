"use client";

// Shared page heading and sizes for the back-office pages (dashboard,
// inventory, orders…): a small label pill, a large title and subtitle, and
// the page's action buttons on the right.
import type { ReactNode } from "react";

// Buttons in a page heading.
export const headerButton = "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-[15px] font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
export const headerPrimaryButton = "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[15px] font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-50";
// Selects next to those buttons.
export const headerSelect = "h-12 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

export function PageTitle({ eyebrow, icon, title, subtitle }: { eyebrow: ReactNode; icon?: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-blue-200/80 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">{icon}{eyebrow}</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-[36px] sm:leading-[1.15]">{title}</h1>
      {subtitle && <p className="mt-2 text-base text-slate-500 sm:text-[17px]">{subtitle}</p>}
    </div>
  );
}

export function PageHeader({ actions, ...title }: Parameters<typeof PageTitle>[0] & { actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <PageTitle {...title} />
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

// A small trend line for stat cards (no axes; the card states the numbers).
export function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 96;
  const height = 32;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * width},${height - 2 - (value / max) * (height - 4)}`).join(" ");
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className={`h-8 w-24 overflow-visible ${className}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
