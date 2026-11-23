import { useId } from 'react';
import { ArrowRight, CalendarCheck2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatCompactCount, type CheckOffTrendSummary } from './dashboardCharts';

interface CheckOffTrendChartProps {
  trend: CheckOffTrendSummary;
  className?: string;
}

const SVG_WIDTH = 480;
const SVG_HEIGHT = 196;
const CHART_LEFT = 16;
const CHART_RIGHT = 398;
const CHART_TOP = 30;
const CHART_BOTTOM = 162;

/**
 * Direct-labeled 14-day gear check-off line chart answering
 * "Are we checking gear regularly?" without detached legends or neon glows.
 */
export function CheckOffTrendChart({ trend, className }: CheckOffTrendChartProps) {
  const gradientId = useId();
  const { points, totalInWindow, roundedDailyAverage, peakCount, todayCount } = trend;

  if (totalInWindow === 0 || points.length === 0) {
    return (
      <div
        className={cn(
          'flex min-h-[196px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center',
          className
        )}
      >
        <CalendarCheck2 className="size-8 text-muted-foreground/60" aria-hidden="true" />
        <p className="font-display text-sm font-semibold text-foreground">
          No gear checked off in the last {points.length || 14} days
        </p>
        <p className="max-w-xs font-sans text-xs text-muted-foreground">
          Items marked checked in the Sunday Checklist will plot here automatically.
        </p>
        <Link
          to="/checklist"
          className="group mt-1 inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-sans text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>Open Sunday Checklist</span>
          <ArrowRight
            className="size-3.5 transition-[transform,translate] duration-150 ease-out group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      </div>
    );
  }

  const yMax = Math.max(peakCount, roundedDailyAverage, 4);
  const chartWidth = CHART_RIGHT - CHART_LEFT;
  const chartHeight = CHART_BOTTOM - CHART_TOP;

  const coordinates = points.map((point, index) => {
    const x =
      points.length > 1
        ? CHART_LEFT + (index / (points.length - 1)) * chartWidth
        : CHART_LEFT + chartWidth / 2;
    const y = CHART_BOTTOM - (point.count / yMax) * chartHeight;
    return { ...point, x, y };
  });

  const linePath = coordinates
    .map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const firstPt = coordinates[0];
  const lastPt = coordinates[coordinates.length - 1];
  const areaPath = `${linePath} L ${lastPt.x.toFixed(1)} ${CHART_BOTTOM} L ${firstPt.x.toFixed(1)} ${CHART_BOTTOM} Z`;

  const avgY = CHART_BOTTOM - (roundedDailyAverage / yMax) * chartHeight;
  const showAvgLine = roundedDailyAverage > 0;
  const avgLabelY = Math.max(14, avgY - 7);

  // Place end-of-line label directly to the right of the terminal point so it never crosses the line
  const todayLabel = `Today: ${formatCompactCount(todayCount)}`;
  const todayLabelX = lastPt.x + 10;
  const todayLabelY = Math.max(16, Math.min(CHART_BOTTOM - 2, lastPt.y + 4));

  const midIndex = Math.floor((coordinates.length - 1) / 2);
  const midPt = coordinates[midIndex];

  // Show peak callout when peak occurred strictly before Today
  const peakPoint =
    peakCount > 0
      ? coordinates.find((pt, idx) => pt.count === peakCount && idx < coordinates.length - 1)
      : undefined;

  const itemNoun = totalInWindow === 1 ? 'item' : 'items';
  const summaryAriaLabel = `14-day check-off trend: ${formatCompactCount(totalInWindow)} ${itemNoun} checked, average ${formatCompactCount(roundedDailyAverage)} per day, ${formatCompactCount(todayCount)} checked today.`;

  return (
    <div className={cn('space-y-2', className)}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        role="img"
        aria-label={summaryAriaLabel}
        className="h-auto w-full overflow-visible select-none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary, #2563EB)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-primary, #2563EB)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Baseline & midpoint guide */}
        <line
          x1={CHART_LEFT}
          y1={CHART_BOTTOM}
          x2={CHART_RIGHT}
          y2={CHART_BOTTOM}
          stroke="var(--color-border, #E2E8F0)"
          strokeWidth="1"
        />
        <line
          x1={CHART_LEFT}
          y1={CHART_TOP + chartHeight / 2}
          x2={CHART_RIGHT}
          y2={CHART_TOP + chartHeight / 2}
          stroke="var(--color-border, #E2E8F0)"
          strokeWidth="1"
          strokeOpacity="0.55"
        />

        {/* Matte area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Dashed average line with direct inline label on the left */}
        {showAvgLine && (
          <g>
            <line
              x1={CHART_LEFT}
              y1={avgY}
              x2={CHART_RIGHT}
              y2={avgY}
              stroke="var(--color-muted-foreground, #475569)"
              strokeOpacity="0.45"
              strokeWidth="1.25"
              strokeDasharray="4 4"
            />
            <text
              x={CHART_LEFT}
              y={avgLabelY}
              textAnchor="start"
              className="fill-muted-foreground font-sans text-[11px] font-medium tabular-nums"
            >
              {`Avg ${formatCompactCount(roundedDailyAverage)}/day`}
            </text>
          </g>
        )}

        {/* Primary series line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-primary, #2563EB)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Subtle peak marker with direct label when peak precedes Today */}
        {peakPoint && (
          <g>
            <circle
              cx={peakPoint.x}
              cy={peakPoint.y}
              r="3.5"
              fill="var(--color-background, #F8FAFC)"
              stroke="var(--color-primary, #2563EB)"
              strokeOpacity="0.8"
              strokeWidth="2"
            />
            <text
              x={peakPoint.x}
              y={Math.max(14, peakPoint.y - 10)}
              textAnchor={peakPoint.x < CHART_LEFT + 55 ? 'start' : 'middle'}
              className="fill-muted-foreground font-sans text-[11px] font-medium tabular-nums"
            >
              {`Peak: ${formatCompactCount(peakPoint.count)}`}
            </text>
          </g>
        )}

        {/* Endpoint marker & direct right-side label */}
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="4.5"
          fill="var(--color-primary, #2563EB)"
          stroke="var(--color-card, #FFFFFF)"
          strokeWidth="2"
        />
        <text
          x={todayLabelX}
          y={todayLabelY}
          textAnchor="start"
          className="fill-foreground font-sans text-[12px] font-semibold tabular-nums"
        >
          {todayLabel}
        </text>

        {/* Minimal 3-point X-axis labels */}
        <text
          x={firstPt.x}
          y={SVG_HEIGHT - 8}
          textAnchor="start"
          className="fill-muted-foreground font-sans text-[11px]"
        >
          {firstPt.shortLabel}
        </text>
        {midPt && midIndex > 0 && midIndex < coordinates.length - 1 && (
          <text
            x={midPt.x}
            y={SVG_HEIGHT - 8}
            textAnchor="middle"
            className="fill-muted-foreground font-sans text-[11px]"
          >
            {midPt.shortLabel}
          </text>
        )}
        <text
          x={lastPt.x}
          y={SVG_HEIGHT - 8}
          textAnchor="end"
          className="fill-foreground font-sans text-[11px] font-medium"
        >
          {lastPt.shortLabel}
        </text>
      </svg>
    </div>
  );
}
