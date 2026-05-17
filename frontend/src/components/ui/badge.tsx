import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-slate-900 text-white',
        secondary: 'border-transparent bg-slate-100 text-slate-700',
        destructive: 'border-transparent bg-red-100 text-red-700 border-red-200',
        outline: 'border-slate-300 text-slate-700',
        draft: 'bg-gray-100 text-gray-700 border-gray-300',
        submitted: 'bg-blue-100 text-blue-700 border-blue-300',
        returned: 'bg-amber-100 text-amber-700 border-amber-300',
        approved: 'bg-green-100 text-green-700 border-green-300',
        locked: 'bg-purple-100 text-purple-700 border-purple-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
