import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatScore } from '@/utils/scoring'
import type { QuarterScorePoint } from '@/lib/quarterlyScoreTrend'

const PRIMARY_FILL = '#2563eb'

interface ScoreTrendChartProps {
  data: QuarterScorePoint[]
  periodLabel: string
}

export function ScoreTrendChart({ data, periodLabel }: ScoreTrendChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500">
          Your score trend will appear here after your first check-in is submitted.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Score by Quarter — {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="quarter"
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number, name, props) => {
                  const isSnapshot = props.payload?.isSnapshot
                  const label = isSnapshot ? 'Score (Frozen)' : 'Score'
                  return [`${formatScore(value)} pts`, label]
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="score" fill={PRIMARY_FILL} radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
