import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import type { GoalSheet, GoalSheetStatus } from '@/types'

const STATUS_VARIANT: Record<
  GoalSheetStatus,
  'draft' | 'submitted' | 'returned' | 'approved' | 'locked'
> = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  RETURNED: 'returned',
  APPROVED: 'approved',
  LOCKED: 'locked',
}

const STATUS_LABEL: Record<GoalSheetStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
}

interface GoalSheetStatusBannerProps {
  sheet: GoalSheet
  checkInWindowOpen: boolean
  returnComment?: string | null
}

export function GoalSheetStatusBanner({
  sheet,
  checkInWindowOpen,
  returnComment,
}: GoalSheetStatusBannerProps) {
  const comment = returnComment ?? sheet.review_comment

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
      <Badge variant={STATUS_VARIANT[sheet.status]}>{STATUS_LABEL[sheet.status]}</Badge>
      <span className="text-sm text-slate-600">Goal sheet · {sheet.period_label}</span>

      {sheet.status === 'RETURNED' && comment && (
        <p className="w-full text-sm text-amber-700">
          <span className="font-medium">Manager feedback: </span>
          {comment}
        </p>
      )}

      {sheet.status === 'LOCKED' && checkInWindowOpen && (
        <Link
          to="/employee/checkins"
          className="ml-auto text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          → Open Check-ins
        </Link>
      )}
    </div>
  )
}

