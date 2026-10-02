import { useState } from 'react';
import './ColumnChart.css';

export type ColumnDatum = { label: string; value: number };

export type ColumnChartProps = {
  data: ColumnDatum[];
  /** How a value reads in the tooltip, the peak label, and the summary. */
  format: (value: number) => string;
  /** What the chart plots, e.g. "Collected by day" — used for the text summary. */
  title: string;
  /** Draw every nth axis label so dense ranges (30 days) don't collide. */
  labelEvery?: number;
};

/**
 * Single-series column chart, in ink like the overview's sales bars. Plain
 * divs — height is the only geometry. The peak carries the one direct label;
 * hovering any column shows its value. Screen readers get a text summary, and
 * every chart on the reports page sits beside a table of the same numbers.
 */
export function ColumnChart({ data, format, title, labelEvery = 1 }: ColumnChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const peak = Math.max(...data.map((d) => d.value), 0);
  const peakIndex = data.findIndex((d) => d.value === peak && peak > 0);

  const summary = `${title}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`;

  return (
    <div className="colchart" role="img" aria-label={summary}>
      <div className="colchart__plot" onMouseLeave={() => setHovered(null)}>
        {data.map((d, i) => {
          const pct = peak > 0 ? (d.value / peak) * 100 : 0;
          const emphasis = i === hovered || (hovered === null && i === peakIndex);
          return (
            <div
              key={`${d.label}-${i}`}
              className="colchart__slot"
              onMouseEnter={() => setHovered(i)}
            >
              {(i === hovered || (hovered === null && i === peakIndex)) && (
                <div
                  className={
                    i === hovered ? 'colchart__tip colchart__tip--hover' : 'colchart__tip'
                  }
                  style={{ bottom: `calc(${pct}% + 6px)` }}
                >
                  {i === hovered && <span className="colchart__tip-label">{d.label}</span>}
                  <span className="mono">{format(d.value)}</span>
                </div>
              )}
              <div
                className={emphasis ? 'colchart__bar colchart__bar--on' : 'colchart__bar'}
                // A sliver for zero keeps the slot readable as "nothing", not missing.
                style={{ height: d.value > 0 ? `max(${pct}%, 2px)` : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="colchart__axis" aria-hidden="true">
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`} className="colchart__tick">
            {i % labelEvery === 0 || i === data.length - 1 ? d.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
