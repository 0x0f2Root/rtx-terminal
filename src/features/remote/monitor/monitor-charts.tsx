import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatClock } from '../format';
import type { ChartPoint } from './monitor-data';

/**
 * Time-series charts for the monitor, on the ReUI/shadcn chart primitives. Every chart plots
 * local sample time on X. A missing sample is a gap in the line, never a segment drawn across it:
 * nothing is plotted for time the monitor did not observe. Series colors come from the validated
 * --chart-* tokens in fixed order, so each chart's first series is always --chart-1.
 */

const AXIS = { tickLine: false, axisLine: false } as const;

function timeAxis() {
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={['dataMin', 'dataMax']}
      tickFormatter={(value: number) => formatClock(value)}
      minTickGap={56}
      {...AXIS}
    />
  );
}

/** Tooltip rows in the chart's own markup, with the value formatted in its unit. */
function tooltip(config: ChartConfig, format: (value: number) => string) {
  return (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_label, payload) =>
            payload?.[0] ? formatClock(Number(payload[0].payload.t)) : ''
          }
          formatter={(value, name, item) => (
            <div className="flex w-full items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">
                {config[String(name)]?.label ?? name}
              </span>
              <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                {typeof value === 'number' ? format(value) : '—'}
              </span>
            </div>
          )}
        />
      }
    />
  );
}

/** A filled area trend for one series, such as CPU or memory utilization. */
export function AreaTrend({
  data,
  dataKey,
  config,
  domain,
  axisFormatter,
  valueFormatter,
  className,
}: {
  data: ChartPoint[];
  dataKey: string;
  config: ChartConfig;
  domain?: [number | 'auto', number | 'auto'];
  axisFormatter: (value: number) => string;
  valueFormatter: (value: number) => string;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        {timeAxis()}
        <YAxis
          width={40}
          domain={domain}
          tickFormatter={axisFormatter}
          {...AXIS}
        />
        {tooltip(config, valueFormatter)}
        <Area
          dataKey={dataKey}
          type="monotone"
          fill={`var(--color-${dataKey})`}
          fillOpacity={0.12}
          stroke={`var(--color-${dataKey})`}
          strokeWidth={2}
          isAnimationActive={false}
          connectNulls={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Two or more line series on one axis, such as receive and transmit throughput, with a legend. */
export function LineTrend({
  data,
  keys,
  config,
  axisFormatter,
  valueFormatter,
  className,
}: {
  data: ChartPoint[];
  keys: string[];
  config: ChartConfig;
  axisFormatter: (value: number) => string;
  valueFormatter: (value: number) => string;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        {timeAxis()}
        <YAxis
          width={40}
          domain={[0, 'auto']}
          tickFormatter={axisFormatter}
          {...AXIS}
        />
        {tooltip(config, valueFormatter)}
        <ChartLegend content={<ChartLegendContent />} />
        {keys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls={false}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/** A small trend line for an overview tile: no axes or tooltip, the tile states the value. */
export function Sparkline({
  data,
  dataKey,
  config,
  domain,
}: {
  data: ChartPoint[];
  dataKey: string;
  config: ChartConfig;
  domain?: [number | 'auto', number | 'auto'];
}) {
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-8 w-full"
      aria-hidden="true"
    >
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 2, bottom: 2 }}>
        <YAxis hide domain={domain ?? [0, 'auto']} />
        <XAxis hide dataKey="t" type="number" domain={['dataMin', 'dataMax']} />
        <Area
          dataKey={dataKey}
          type="monotone"
          fill={`var(--color-${dataKey})`}
          fillOpacity={0.12}
          stroke={`var(--color-${dataKey})`}
          strokeWidth={1.5}
          isAnimationActive={false}
          connectNulls={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
