/**
 * PageHeader — in-content page header used below the AppShell topbar.
 *
 * Role breadcrumb is rendered once in AppShell's topbar — not here.
 *
 * Structure:
 *   1. Page title (large, bold)
 *   2. Optional subtitle
 */
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  titleClassName?: string
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  titleClassName,
}: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className={cn('page-title', titleClassName)}>{title}</h1>
        {subtitle}
      </div>
      {actions}
    </div>
  )
}
