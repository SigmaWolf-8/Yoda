import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Activity } from 'lucide-react';

interface DataPoint {
  timestamp: string;
  engine_a?: number;
  engine_b?: number;
  engine_c?: number;
}

interface Props {
  data: DataPoint[];
}

const RANGES = [
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
  { label: 'All', minutes: Infinity },
] as const;

const ENGINE_COLORS = {
  engine_a: '#c9a84c', // gold
  engine_b: '#3b82f6', // blue
  engine_c: '#22c55e', // green
};

export function InferenceMetricsChart({ data }: Props) {
  const [range, setRange] = useState(60);

  const filtered = useMemo(() => {
    if (range === Infinity) return data;
    const cutoff = Date.now() - range * 60 * 1000;
    return data.filter((d) => new Date(d.timestamp).getTime() >= cutoff);
  }, [data, range]);

  // If no data, show placeholder
  if (!data.length) {
    return (
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-[var(--color-gold-400)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI Response Latency</h3>
        </div>
        <div className="flex items-center justify-center h-48 text-sm text-[var(--color-text-muted)]">
          No data yet. Run a pipeline to see metrics.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--color-gold-400)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI Response Latency</h3>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.minutes)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                range === r.minutes
                  ? 'bg-[var(--color-gold-500)]/10 text-[var(--color-gold-400)] border border-[var(--color-gold-500)]/20'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={filtered} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-navy-700)" strokeOpacity={0.5} />
          <XAxis
            dataKey="timestamp"
            tick={{ fill: 'var(--color-navy-400)', fontSize: 9 }}
            tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            stroke="var(--color-navy-700)"
          />
          <YAxis
            tick={{ fill: 'var(--color-navy-400)', fontSize: 9 }}
            stroke="var(--color-navy-700)"
            tickFormatter={(v) => `${v}ms`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-navy-800)',
              border: '1px solid var(--color-navy-600)',
              borderRadius: '8px',
              fontSize: '13px',
              color: 'var(--color-navy-100)',
            }}
            labelFormatter={(v) => new Date(v).toLocaleString()}
            formatter={(value) => [`${value}ms`, undefined]}
          />
          <Legend
            wrapperStyle={{ fontSize: '13px', color: 'var(--color-navy-300)' }}
          />
          <Line type="monotone" dataKey="engine_a" name="Engine A" stroke={ENGINE_COLORS.engine_a} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="engine_b" name="Engine B" stroke={ENGINE_COLORS.engine_b} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="engine_c" name="Engine C" stroke={ENGINE_COLORS.engine_c} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
