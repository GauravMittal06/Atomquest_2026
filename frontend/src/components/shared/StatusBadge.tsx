import { cn } from '@/lib/utils'
import type { GoalSheetStatus } from '@/types'

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

const STATUS_CLASS: Record<GoalSheetStatus, string> = {
  DRAFT: 'badge-draft',
  SUBMITTED: 'badge-submitted',
  RETURNED: 'badge-returned',
  APPROVED: 'badge-approved',
  LOCKED: 'badge-locked',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn(STATUS_CLASS[status], className)}>
      {STATUS_LABELS[status]}
    </span>
  )
}
