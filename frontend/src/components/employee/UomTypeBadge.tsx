import { Badge } from '@/components/ui/badge'
import type { UoMType } from '@/types'

const TYPE_VARIANT: Record<
  string,
  'submitted' | 'returned' | 'outline'
> = {
  Numeric: 'submitted',
  Timeline: 'returned',
}

export function UomTypeBadge({ uomType }: { uomType?: UoMType | string | null }) {
  if (!uomType || !(uomType in TYPE_VARIANT)) {
    return (
      <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">
        —
      </Badge>
    )
  }

  if (uomType === 'Zero') {
    return (
      <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">
        Zero
      </Badge>
    )
  }

  return <Badge variant={TYPE_VARIANT[uomType]}>{uomType}</Badge>
}
