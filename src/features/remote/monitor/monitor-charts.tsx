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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatClock } from '../format';

/** A chart point is one sample's value(s) at a timestamp. The X axis is always local time. */
export type ChartPoint = { t: number } & Record<string, number | null>;

const AXIS_PROPS = {
  stroke: 'var(--color-muted-foreground)',
  fontSize: 10,
  tickLine: false,
  axisLine: false,
} as const;

function timeTick(value: number): string {
  return formatClock(value);
}

/** A filled area trend for a single series such as CPU or memory utilization. */
export function AreaTrend({
  data,
  dataKey,
  config,
  domain,
  valueFormatter,
  className,
}: {
  data: ChartPoint[];
  dataKey: string;
  config: ChartConfig;
  domain?: [number | 'auto', number | 'auto'];
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={timeTick}
          minTickGap={48}
          {...AXIS_PROPS}
        />
        <YAxis
          width={44}
          domain={domain}
          tickFormatter={(v: number) =>
            valueFormatter ? valueFormatter(v) : String(v)
          }
          {...AXIS_PROPS}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                payload?.[0] ? formatClock(Number(payload[0].payload.t)) : ''
              }
            />
          }
        />
        <Area
          dataKey={dataKey}
          type="monotone"
          fill={`var(--color-${dataKey})`}
          fillOpacity={0.15}
          stroke={`var(--color-${dataKey})`}
          strokeWidth={1.5}
          isAnimationActive={false}
          connectNulls
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Two overlaid line series such as network receive and transmit throughput. */
export function DualLineTrend({
  data,
  keys,
  config,
  valueFormatter,
  className,
}: {
  data: ChartPoint[];
  keys: [string, string];
  config: ChartConfig;
  valueFormatter?: (value: number) => string;
  className?: string;
}) {
  return (
    <ChartContainer config={config} className={className}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={timeTick}
          minTickGap={48}
          {...AXIS_PROPS}
        />
        <YAxis
          width={52}
          tickFormatter={(v: number) =>
            valueFormatter ? valueFormatter(v) : String(v)
          }
          {...AXIS_PROPS}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                payload?.[0] ? formatClock(Number(payload[0].payload.t)) : ''
              }
            />
          }
        />
        {keys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={1.5}
            isAnimationActive={false}
            connectNulls
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
