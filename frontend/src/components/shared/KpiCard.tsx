import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  accent?: 'blue' | 'green' | 'amber' | 'purple' | 'slate'
  className?: string
}

const ACCENT_STYLES: Record<NonNullable<KpiCardProps['accent']>, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
  slate: 'bg-slate-50 border-slate-200 text-slate-700',
}

export function KpiCard({ label, value, sub, icon, accent = 'slate', className }: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-5 flex flex-col gap-1 shadow-sm',
        ACCENT_STYLES[accent],
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
    </div>
  )
}
