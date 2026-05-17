import { cn } from '@/lib/utils'
import type { GoalSheetStatus } from '@/types'
import { STATUS_BADGE_STYLES } from '@/types'

interface StatusBadgeProps {
  status: GoalSheetStatus
  className?: string
}

const STATUS_LABELS: Record<GoalSheetStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_BADGE_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
