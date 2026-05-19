/**
 * Admin Escalations Page — Governance dashboard for automatic escalations.
 *
 * Data sources:
 *   GET  /api/escalations              — list by status filter
 *   POST /api/escalations/run          — manually run escalation engine
 *   PATCH /api/escalations/{id}        — resolve an active escalation
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  ShieldAlert,
  X,
} from 'lucide-react'

import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | 'ACTIVE' | 'RESOLVED'

type TriggerType = 'SUBMISSION_DELAY' | 'APPROVAL_DELAY' | 'CHECKIN_DELAY'

interface EscalationRow {
  _id: string
  escalation_id: string
  goal_sheet_id: string
  employee_id: string
  manager_id: string
  trigger_type: TriggerType
  level: 1 | 2
  status: 'ACTIVE' | 'RESOLVED'
  created_at: string
  resolved_at?: string | null
  resolution_notes?: string | null
}

interface RunEngineResult {
  submission_delay_count: number
  approval_delay_count: number
  checkin_delay_count: number
  level_2_promotions: number
  total_active: number
}

type ToastKind = 'success' | 'error'

interface ToastState {
  kind: ToastKind
  message: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRIGGER_LABELS: Record<TriggerType, string> = {
  SUBMISSION_DELAY: 'Submission Delay',
  APPROVAL_DELAY: 'Approval Delay',
  CHECKIN_DELAY: 'Check-in Delay',
}

function formatCreatedAtUtc(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const min = String(d.getUTCMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`
  } catch {
    return '—'
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
    if (typeof detail === 'string') return detail
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminEscalationsPage() {
  const [escalations, setEscalations] = useState<EscalationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')

  const [runningEngine, setRunningEngine] = useState(false)

  const [resolveTarget, setResolveTarget] = useState<EscalationRow | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [resolveLoading, setResolveLoading] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement | null>(null)

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((kind: ToastKind, message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ kind, message })
    toastTimerRef.current = setTimeout(() => setToast(null), 4500)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const loadEscalations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<EscalationRow[]>('/escalations', {
        params: { status_filter: statusFilter },
      })
      setEscalations(res.data)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to load escalations.'))
      setEscalations([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void loadEscalations()
  }, [loadEscalations])

  async function handleRunEngine() {
    setRunningEngine(true)
    try {
      const res = await api.post<RunEngineResult>('/escalations/run')
      const stats = res.data
      showToast(
        'success',
        `Escalation engine completed. ${stats.total_active} active escalation(s).`,
      )
      await loadEscalations()
    } catch (err: unknown) {
      showToast('error', extractErrorMessage(err, 'Failed to run escalation engine.'))
    } finally {
      setRunningEngine(false)
    }
  }

  function openResolveModal(row: EscalationRow) {
    setResolveTarget(row)
    setResolutionNotes('')
    setTimeout(() => notesRef.current?.focus(), 80)
  }

  function closeResolveModal() {
    if (resolveLoading) return
    setResolveTarget(null)
    setResolutionNotes('')
  }

  async function handleConfirmResolve() {
    if (!resolveTarget) return

    setResolveLoading(true)
    try {
      await api.patch(`/escalations/${resolveTarget.escalation_id}`, {
        status: 'RESOLVED',
        resolution_notes: resolutionNotes.trim() || null,
      })
      showToast('success', 'Escalation resolved.')
      setResolveTarget(null)
      setResolutionNotes('')
      await loadEscalations()
    } catch (err: unknown) {
      showToast('error', extractErrorMessage(err, 'Failed to resolve escalation.'))
    } finally {
      setResolveLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg',
            toast.kind === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800',
          )}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />
          ) : (
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          )}
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="breadcrumb">Admin · Escalations</p>
          <h1 className="page-title">Escalations</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatic governance alerts · {escalations.length} shown
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => void handleRunEngine()}
            disabled={runningEngine}
            className="gap-2"
          >
            {runningEngine ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {runningEngine ? 'Running…' : 'Run Escalation Engine'}
          </Button>
          <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
            Admin Only
          </span>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input appearance-none pr-8 cursor-pointer"
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="RESOLVED">Resolved</option>
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden p-0">
        {escalations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ShieldAlert size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">No escalations</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 uppercase tracking-wide border-b border-slate-100">
                <tr>
                  <th className="th text-left">Escalation ID</th>
                  <th className="th text-left">Trigger Type</th>
                  <th className="th text-left">Level</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-left">Created Date</th>
                  <th className="th text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {escalations.map((row) => (
                  <tr key={row.escalation_id} className="tr">
                    <td className="td">
                      <span className="font-mono text-xs text-slate-800">{row.escalation_id}</span>
                    </td>
                    <td className="td">
                      <span className="text-slate-700">
                        {TRIGGER_LABELS[row.trigger_type] ?? row.trigger_type}
                      </span>
                    </td>
                    <td className="td">
                      {row.level === 1 ? (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200">
                          Level 1
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Level 2</Badge>
                      )}
                    </td>
                    <td className="td">
                      {row.status === 'ACTIVE' ? (
                        <Badge className="bg-orange-50 text-orange-700 border-orange-200">
                          ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="approved">RESOLVED</Badge>
                      )}
                    </td>
                    <td className="td">
                      <span className="text-slate-600 font-mono text-xs">
                        {formatCreatedAtUtc(row.created_at)}
                      </span>
                    </td>
                    <td className="td">
                      {row.status === 'ACTIVE' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openResolveModal(row)}
                        >
                          Resolve
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resolve modal */}
      <Dialog open={resolveTarget !== null} onOpenChange={(open) => !open && closeResolveModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Escalation</DialogTitle>
            <DialogDescription>
              Add optional notes explaining how this escalation was addressed (max 500 characters).
            </DialogDescription>
          </DialogHeader>

          {resolveTarget && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-slate-500 font-mono break-all">
                {resolveTarget.escalation_id}
              </p>
              <Textarea
                ref={notesRef}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value.slice(0, 500))}
                placeholder="Resolution notes (optional)…"
                maxLength={500}
                rows={4}
              />
              <p className="text-xs text-slate-400 text-right">
                {resolutionNotes.length}/500
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeResolveModal}
              disabled={resolveLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="success"
              onClick={() => void handleConfirmResolve()}
              disabled={resolveLoading}
            >
              {resolveLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Resolving…
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
