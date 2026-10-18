/**
 * Charts, drawn as plain SVG with no charting dependency.
 *
 * They are sized from a measured container rather than a scaled viewBox. That
 * matters: a viewBox scaled down to phone width would shrink the axis labels
 * below a readable size, so every chart here renders at real pixels and keeps
 * its type at 12px.
 *
 * Colour carries meaning only. One accent hue at two strengths separates
 * reported history from forecast, and the bridge uses the accent for additions
 * against the negative tone for deductions. Each chart sits beside the table
 * holding the same figures, so nothing is only available as a picture.
 */

import { useEffect, useRef, useState } from 'react';
import type { BridgeLine, ForecastYear } from '../../shared/types';
import { formatCrore, formatCroreSigned, formatPerShare } from '../lib/format';

const AXIS_FONT = 12;

/** Measure the container so the SVG can be drawn at real pixel sizes. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(next));
    });
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}

const compact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
};

/* --- Revenue and margin, history against forecast ----------------------- */

export interface RevenueSeriesPoint {
  label: string;
  revenue: number;
  marginPct: number;
  kind: 'history' | 'forecast';
}

export function RevenueMarginChart({ data }: { data: RevenueSeriesPoint[] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const height = 260;
  const pad = { top: 16, right: 44, bottom: 44, left: 48 };

  if (data.length === 0) return null;

  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const maxRevenue = Math.max(...data.map((point) => point.revenue));
  const ticks = niceTicks(maxRevenue);
  const scaleMax = ticks[ticks.length - 1] || 1;
  const bandWidth = plotWidth / data.length;
  const barWidth = Math.max(6, Math.min(40, bandWidth * 0.56));

  const maxMargin = Math.max(...data.map((point) => point.marginPct)) * 1.25 || 1;
  const marginY = (value: number) => pad.top + plotHeight - (value / maxMargin) * plotHeight;
  const bandCentre = (index: number) => pad.left + bandWidth * index + bandWidth / 2;

  // Crowded x axes drop every other label rather than shrinking the type.
  const labelStride = bandWidth < 56 ? 2 : 1;

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-labelledby="revenue-chart-title">
          <title id="revenue-chart-title">
            Revenue by financial year with the operating margin, reported years followed by forecast years
          </title>
          {ticks.map((tick) => {
            const y = pad.top + plotHeight - (tick / scaleMax) * plotHeight;
            return (
              <g key={tick}>
                <line className="chart-grid-line" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
                <text className="chart-label" x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={AXIS_FONT}>
                  {compact(tick)}
                </text>
              </g>
            );
          })}

          {data.map((point, index) => {
            const barHeight = (point.revenue / scaleMax) * plotHeight;
            return (
              <rect
                key={point.label}
                x={bandCentre(index) - barWidth / 2}
                y={pad.top + plotHeight - barHeight}
                width={barWidth}
                height={Math.max(1, barHeight)}
                rx={2}
                fill={point.kind === 'history' ? 'var(--accent)' : 'var(--accent-wash)'}
                stroke={point.kind === 'forecast' ? 'var(--accent)' : 'none'}
                strokeWidth={point.kind === 'forecast' ? 1 : 0}
              />
            );
          })}

          <polyline
            points={data.map((point, index) => `${bandCentre(index)},${marginY(point.marginPct)}`).join(' ')}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {data.map((point, index) => (
            <circle key={`dot-${point.label}`} cx={bandCentre(index)} cy={marginY(point.marginPct)} r={2.5} fill="var(--ink)" />
          ))}

          <line className="chart-axis-line" x1={pad.left} x2={width - pad.right} y1={pad.top + plotHeight} y2={pad.top + plotHeight} />

          {data.map((point, index) =>
            index % labelStride === 0 ? (
              <text
                key={`label-${point.label}`}
                className="chart-label"
                x={bandCentre(index)}
                y={height - 24}
                textAnchor="middle"
                fontSize={AXIS_FONT}
              >
                {point.label.replace('FY', '')}
              </text>
            ) : null,
          )}

          <text className="chart-label" x={width - pad.right + 8} y={marginY(data[data.length - 1].marginPct) + 4} fontSize={AXIS_FONT}>
            {data[data.length - 1].marginPct.toFixed(1)}%
          </text>
        </svg>
      ) : (
        <div className="skeleton" style={{ height }} />
      )}
      <div className="chart-legend">
        <span><i className="chart-swatch" style={{ background: 'var(--accent)' }} />Reported revenue</span>
        <span><i className="chart-swatch" style={{ background: 'var(--accent-wash)', border: '1px solid var(--accent)' }} />Forecast revenue</span>
        <span><i className="chart-swatch" style={{ background: 'var(--ink)', height: 2, borderRadius: 0 }} />Operating margin, right scale</span>
      </div>
    </div>
  );
}

/* --- Free cash flow and its present value ------------------------------- */

export function FcffChart({ forecast }: { forecast: ForecastYear[] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 44, left: 48 };

  if (forecast.length === 0) return null;

  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(...forecast.map((row) => Math.max(row.fcff, row.presentValueFcff)));
  const ticks = niceTicks(max);
  const scaleMax = ticks[ticks.length - 1] || 1;
  const bandWidth = plotWidth / forecast.length;
  const barWidth = Math.max(6, Math.min(26, bandWidth * 0.3));
  const labelStride = bandWidth < 72 ? 2 : 1;

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-labelledby="fcff-chart-title">
          <title id="fcff-chart-title">
            Forecast free cash flow to the firm each year, against its present value after discounting
          </title>
          {ticks.map((tick) => {
            const y = pad.top + plotHeight - (tick / scaleMax) * plotHeight;
            return (
              <g key={tick}>
                <line className="chart-grid-line" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
                <text className="chart-label" x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={AXIS_FONT}>
                  {compact(tick)}
                </text>
              </g>
            );
          })}

          {forecast.map((row, index) => {
            const centre = pad.left + bandWidth * index + bandWidth / 2;
            const fcffHeight = (row.fcff / scaleMax) * plotHeight;
            const pvHeight = (row.presentValueFcff / scaleMax) * plotHeight;
            return (
              <g key={row.year}>
                <rect
                  x={centre - barWidth - 2}
                  y={pad.top + plotHeight - fcffHeight}
                  width={barWidth}
                  height={Math.max(1, fcffHeight)}
                  rx={2}
                  fill="var(--accent-wash)"
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
                <rect
                  x={centre + 2}
                  y={pad.top + plotHeight - pvHeight}
                  width={barWidth}
                  height={Math.max(1, pvHeight)}
                  rx={2}
                  fill="var(--accent)"
                />
                {index % labelStride === 0 ? (
                  <text className="chart-label" x={centre} y={height - 24} textAnchor="middle" fontSize={AXIS_FONT}>
                    {row.year.replace('FY', '')}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line className="chart-axis-line" x1={pad.left} x2={width - pad.right} y1={pad.top + plotHeight} y2={pad.top + plotHeight} />
        </svg>
      ) : (
        <div className="skeleton" style={{ height }} />
      )}
      <div className="chart-legend">
        <span><i className="chart-swatch" style={{ background: 'var(--accent-wash)', border: '1px solid var(--accent)' }} />Free cash flow</span>
        <span><i className="chart-swatch" style={{ background: 'var(--accent)' }} />Present value</span>
      </div>
    </div>
  );
}

/* --- The value bridge ---------------------------------------------------
   Drawn horizontally so the line-item names read straight across and the
   chart works at phone width without a second layout.
   ----------------------------------------------------------------------- */

export function BridgeWaterfall({ lines, unit }: { lines: BridgeLine[]; unit: string }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const rowHeight = 44;
  const pad = { top: 8, right: 8, bottom: 32, left: 8 };
  const labelWidth = width >= 640 ? 240 : Math.max(132, width * 0.42);
  const valueWidth = width >= 640 ? 104 : 88;
  const height = pad.top + lines.length * rowHeight + pad.bottom;

  const plotLeft = pad.left + labelWidth + 12;
  const plotWidth = Math.max(40, width - plotLeft - valueWidth - pad.right - 12);

  const values = lines.flatMap((line) =>
    line.kind === 'start' || line.kind === 'total'
      ? [line.runningTotal]
      : [line.runningTotal - line.amount, line.runningTotal],
  );
  const domainMax = Math.max(...values, 0);
  const domainMin = Math.min(...values, 0);
  const span = domainMax - domainMin || 1;
  const x = (value: number) => plotLeft + ((value - domainMin) / span) * plotWidth;

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-labelledby="bridge-chart-title">
          <title id="bridge-chart-title">
            Walk from enterprise value to equity value, one claim at a time, in {unit}
          </title>

          {lines.map((line, index) => {
            const y = pad.top + index * rowHeight;
            const centre = y + rowHeight / 2;
            const isAnchor = line.kind === 'start' || line.kind === 'total';
            const from = isAnchor ? 0 : line.runningTotal - line.amount;
            const to = isAnchor ? line.runningTotal : line.runningTotal;
            const barLeft = Math.min(x(from), x(to));
            const barRight = Math.max(x(from), x(to));
            const fill = isAnchor
              ? 'var(--ink)'
              : line.kind === 'subtract'
                ? 'var(--neg)'
                : 'var(--accent)';

            return (
              <g key={line.key}>
                {index > 0 ? (
                  <line className="chart-grid-line" x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
                ) : null}

                <text
                  className="chart-value-label"
                  x={pad.left}
                  y={centre + 4}
                  fontSize={AXIS_FONT}
                  style={{ fontFamily: 'var(--font-sans)', fill: 'var(--ink)' }}
                >
                  {line.label.length > 30 && width < 640 ? `${line.label.slice(0, 29)}…` : line.label}
                </text>

                <rect
                  x={barLeft}
                  y={centre - 11}
                  width={Math.max(2, barRight - barLeft)}
                  height={22}
                  rx={2}
                  fill={fill}
                  opacity={isAnchor ? 1 : 0.9}
                />

                {/* Connector to the next bar's starting edge. */}
                {!isAnchor && index < lines.length - 1 ? (
                  <line
                    x1={x(line.runningTotal)}
                    x2={x(line.runningTotal)}
                    y1={centre + 11}
                    y2={centre + rowHeight - 11}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                ) : null}

                <text
                  className="chart-value-label"
                  x={width - pad.right}
                  y={centre + 4}
                  textAnchor="end"
                  fontSize={AXIS_FONT}
                >
                  {isAnchor ? formatCrore(line.runningTotal) : formatCroreSigned(line.amount)}
                </text>
              </g>
            );
          })}

          <line
            className="chart-axis-line"
            x1={x(0)}
            x2={x(0)}
            y1={pad.top}
            y2={pad.top + lines.length * rowHeight}
          />
          <text className="chart-label" x={pad.left} y={height - 10} fontSize={AXIS_FONT}>
            All figures in {unit}
          </text>
        </svg>
      ) : (
        <div className="skeleton" style={{ height: 260 }} />
      )}
      <div className="chart-legend">
        <span><i className="chart-swatch" style={{ background: 'var(--ink)' }} />Enterprise and equity value</span>
        <span><i className="chart-swatch" style={{ background: 'var(--neg)' }} />Claims deducted</span>
        <span><i className="chart-swatch" style={{ background: 'var(--accent)' }} />Assets added back</span>
      </div>
    </div>
  );
}

/* --- Scenarios ----------------------------------------------------------- */

export interface ScenarioPoint {
  key: string;
  label: string;
  valuePerShare: number | null;
  active: boolean;
}

export function ScenarioChart({ points }: { points: ScenarioPoint[] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const rowHeight = 52;
  const pad = { top: 8, right: 8, bottom: 12, left: 8 };
  const labelWidth = width >= 560 ? 96 : 72;
  const valueWidth = width >= 560 ? 120 : 104;
  const height = pad.top + points.length * rowHeight + pad.bottom;
  const plotLeft = pad.left + labelWidth + 8;
  const plotWidth = Math.max(32, width - plotLeft - valueWidth - pad.right);
  const max = Math.max(...points.map((point) => point.valuePerShare ?? 0), 1);

  return (
    <div className="chart-frame" ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-labelledby="scenario-chart-title">
          <title id="scenario-chart-title">Implied value per share under the bear, base and bull scenarios</title>
          {points.map((point, index) => {
            const y = pad.top + index * rowHeight;
            const centre = y + rowHeight / 2;
            const barWidth = ((point.valuePerShare ?? 0) / max) * plotWidth;
            return (
              <g key={point.key}>
                <text
                  x={pad.left}
                  y={centre + 4}
                  fontSize={AXIS_FONT}
                  style={{ fontFamily: 'var(--font-sans)', fill: 'var(--ink)', fontWeight: point.active ? 500 : 400 }}
                >
                  {point.label}
                </text>
                <rect
                  x={plotLeft}
                  y={centre - 13}
                  width={Math.max(2, barWidth)}
                  height={26}
                  rx={2}
                  fill={point.active ? 'var(--accent)' : 'var(--accent-wash)'}
                  stroke={point.active ? 'none' : 'var(--accent)'}
                  strokeWidth={point.active ? 0 : 1}
                />
                <text className="chart-value-label" x={width - pad.right} y={centre + 4} textAnchor="end" fontSize={AXIS_FONT}>
                  {point.valuePerShare === null ? 'cannot be valued' : formatPerShare(point.valuePerShare)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="skeleton" style={{ height: 180 }} />
      )}
    </div>
  );
}
