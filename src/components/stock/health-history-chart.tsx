"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The health score by fiscal year, on the full 0 to 10 scale.
 *
 * Fixed to the whole scale on purpose: an axis fitted to the data turns a
 * move from 7.8 to 8.1 into a cliff. The figures are also listed in a table
 * beside it, so nothing here is only available to somebody who can see it.
 */
export function HealthHistoryChart({ points }: { points: { year: number; score: number }[] }) {
  return (
    <div
      className="h-48 w-full"
      role="img"
      aria-label={`Health score by fiscal year: ${points.map((p) => `FY${p.year} ${p.score.toFixed(1)}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="year"
            tickFormatter={(year) => `FY${year}`}
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 10]}
            ticks={[0, 2.5, 5, 7.5, 10]}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--foreground)",
            }}
            labelFormatter={(year) => `FY${year}`}
            formatter={(value) => [`${Number(value).toFixed(1)} / 10`, "Health"]}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--accent)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
