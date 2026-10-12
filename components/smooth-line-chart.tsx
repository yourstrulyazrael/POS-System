"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type LineSeries = {
  name: string;
  color: string;
  values: number[];
};

type Point = { x: number; y: number };

// Monotone cubic interpolation (Fritsch–Carlson): smooth curves that never
// overshoot the data, so a flat ₱0 stretch never dips below the baseline.
function monotonePath(points: Point[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const count = points.length;
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = points[index + 1].x - points[index].x;
    slopes.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx);
  }
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === count - 1) return slopes[count - 2];
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
  });
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < count - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const third = (end.x - start.x) / 3;
    path += ` C ${start.x + third} ${start.y + tangents[index] * third}, ${end.x - third} ${end.y - tangents[index + 1] * third}, ${end.x} ${end.y}`;
  }
  return path;
}

export function SmoothLineChart({
  labels,
  series,
  valueFormat,
  tooltipFormat,
  height = 240,
}: {
  labels: string[];
  series: LineSeries[];
  valueFormat?: (value: number) => string;
  tooltipFormat?: (value: number) => string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const formatValue = valueFormat ?? ((value: number) => value.toLocaleString("en-PH"));
  const formatTooltip = tooltipFormat ?? formatValue;
  const left = 52;
  const right = width - 8;
  const top = 12;
  const bottom = height - 28;
  const values = series.flatMap((item) => item.values.filter(Number.isFinite));
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(1, ...values) * 1.08;
  const valueRange = maxValue - minValue || 1;
  const xAt = (index: number) =>
    labels.length < 2 ? (left + right) / 2 : left + (right - left) * index / (labels.length - 1);
  const yAt = (value: number) => bottom - (value - minValue) / valueRange * (bottom - top);
  const ticks = [0, 0.5, 1].map((share) => minValue + (maxValue - minValue) * share);
  const labelCount = Math.max(2, Math.floor((right - left) / 90));
  const xLabelInterval = Math.max(1, Math.ceil(labels.length / labelCount));

  function indexFromPointer(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    if (labels.length < 2) return 0;
    const raw = Math.round((x - left) / (right - left) * (labels.length - 1));
    return Math.min(labels.length - 1, Math.max(0, raw));
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!labels.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActiveIndex((current) => Math.min(labels.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : labels.length)) + step)));
    } else if (event.key === "Escape") {
      setActiveIndex(null);
    }
  }

  const tooltipLeft = activeIndex === null ? 0 : xAt(activeIndex);
  const tooltipOnLeft = tooltipLeft > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        role="img"
        tabIndex={0}
        aria-label={`Line chart showing ${series.map((item) => item.name).join(", ")}. Use the left and right arrow keys to read values.`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full overflow-visible outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-blue-300"
        onPointerMove={(event) => setActiveIndex(indexFromPointer(event))}
        onPointerLeave={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setActiveIndex(null)}
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.name} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity={series.length > 1 ? 0.1 : 0.16} />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((tick, index) => (
          <g key={index}>
            <line x1={left} y1={yAt(tick)} x2={right} y2={yAt(tick)} stroke="currentColor" strokeWidth="1" className={index === 0 ? "text-slate-200 dark:text-slate-700" : "text-slate-100 dark:text-slate-800"} />
            <text x={left - 10} y={yAt(tick) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">{formatValue(tick)}</text>
          </g>
        ))}
        {series.map((item, index) => {
          const points = item.values.map((value, pointIndex) => ({ x: xAt(pointIndex), y: yAt(value) }));
          const line = monotonePath(points);
          const area = points.length > 1 ? `${line} L ${points[points.length - 1].x} ${yAt(minValue)} L ${points[0].x} ${yAt(minValue)} Z` : "";
          return (
            <g key={item.name}>
              {area && <path d={area} fill={`url(#${gradientId}-${index})`} />}
              <path d={line} fill="none" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {activeIndex !== null && (
          <g pointerEvents="none">
            <line x1={xAt(activeIndex)} y1={top} x2={xAt(activeIndex)} y2={bottom} stroke="currentColor" strokeWidth="1" className="text-slate-300 dark:text-slate-600" />
            {series.map((item) => (
              <circle key={item.name} cx={xAt(activeIndex)} cy={yAt(item.values[activeIndex] ?? 0)} r="4" fill={item.color} stroke="currentColor" strokeWidth="2" className="text-white dark:text-slate-800" />
            ))}
          </g>
        )}
        {labels.map((label, index) => (
          (index % xLabelInterval === 0 || index === labels.length - 1) && (
            <text key={`${label}-${index}`} x={xAt(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle"} className="fill-slate-400" fontSize="10">{label}</text>
          )
        ))}
      </svg>
      {activeIndex !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 min-w-[150px] rounded-lg border border-slate-100 bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
          style={tooltipOnLeft ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
        >
          <p className="mb-1.5 font-medium text-slate-400">{labels[activeIndex]}</p>
          {series.map((item) => (
            <p key={item.name} className="flex items-center gap-2 py-0.5">
              <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="font-semibold text-slate-900 dark:text-slate-100">{formatTooltip(item.values[activeIndex] ?? 0)}</span>
              <span className="text-slate-500">{item.name}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
