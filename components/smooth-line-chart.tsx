"use client";

type LineSeries = {
  name: string;
  color: string;
  values: number[];
};

export function SmoothLineChart({
  labels,
  series,
  valueFormat,
}: {
  labels: string[];
  series: LineSeries[];
  valueFormat?: (value: number) => string;
}) {
  const width = 840;
  const height = 280;
  const left = 64;
  const right = width - 16;
  const top = 18;
  const bottom = height - 42;
  const values = series.flatMap((item) => item.values.filter(Number.isFinite));
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(1, ...values);
  const valueRange = maxValue - minValue || 1;
  const pointAt = (value: number, index: number) => ({
    x: labels.length < 2 ? (left + right) / 2 : left + (right - left) * index / (labels.length - 1),
    y: bottom - (value - minValue) / valueRange * (bottom - top),
  });
  const ticks = Array.from({ length: 5 }, (_, index) => minValue + valueRange * index / 4);
  const xLabelInterval = Math.max(1, Math.ceil(labels.length / 8));
  const smoothPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return points.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1];
      const beforePrevious = points[Math.max(0, index - 2)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const controlOne = {
        x: previous.x + (point.x - beforePrevious.x) / 6,
        y: previous.y + (point.y - beforePrevious.y) / 6,
      };
      const controlTwo = {
        x: point.x - (next.x - previous.x) / 6,
        y: point.y - (next.y - previous.y) / 6,
      };
      return `${path} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${point.x} ${point.y}`;
    }, "");
  };
  const formatValue = valueFormat ?? ((value: number) => value.toLocaleString("en-PH"));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        role="img"
        aria-label={`Line chart showing ${series.map((item) => item.name).join(", ")}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-[240px] w-full min-w-[700px] overflow-visible sm:h-[280px]"
      >
        {ticks.map((tick, index) => {
          const y = bottom - index / 4 * (bottom - top);
          return (
            <g key={index}>
              <line x1={left} y1={y} x2={right} y2={y} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeDasharray="4 6" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="fill-slate-400" fontSize="10">{formatValue(tick)}</text>
            </g>
          );
        })}
        {series.map((item) => {
          const points = item.values.map(pointAt);
          return (
            <g key={item.name}>
              <path d={smoothPath(points)} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {points.map((point, index) => (
                <circle key={`${item.name}-${index}`} cx={point.x} cy={point.y} r="3.5" fill={item.color} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke">
                  <title>{`${item.name} · ${labels[index]}: ${formatValue(item.values[index])}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((label, index) => (
          (index % xLabelInterval === 0 || index === labels.length - 1) && (
            <text key={`${label}-${index}`} x={pointAt(0, index).x} y={height - 12} textAnchor="middle" className="fill-slate-400" fontSize="10">{label}</text>
          )
        ))}
      </svg>
    </div>
  );
}
