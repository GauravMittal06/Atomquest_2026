import { calculateAchievementPercentage, calculateGoalScore, UomType, resolveScoreWithPriority } from '@/utils/scoring'
import { ACTIVE_PERIOD_LABELS, type CheckIn, type Goal, type PeriodLabel } from '@/types'
import { resolveAllQuartersVisibility, getAllQuarterSnapshots, type QuarterSnapshot } from '@/services/quarterVisibility'

export interface QuarterScorePoint {
  quarter: PeriodLabel
  score: number
  isSnapshot?: boolean  // Flag to indicate if score came from snapshot
  isVisible?: boolean   // Flag to indicate if quarter should be visible
}

/** 
 * Aggregate weighted score (0–100) per quarter with snapshot-aware resolution.
 * 
 * CRITICAL BEHAVIOR (uses centralized quarter visibility resolver):
 * - FUTURE quarters: hidden (not included in output)
 * - ACTIVE quarters: use LIVE scoring
 * - FROZEN quarters: use SNAPSHOT values (ignore mock date)
 * - CLOSED quarters without snapshot: hidden
 * 
 * This ensures mock-date rollback does NOT erase frozen historical quarters.
 */
export async function buildQuarterlyScoresWithSnapshots(
  goals: Goal[], 
  checkins: CheckIn[],
  sheetId: string
): Promise<QuarterScorePoint[]> {
  if (!sheetId || goals.length === 0) {
    return []
  }

  // Resolve quarter visibility for this sheet
  const visibilitySet = await resolveAllQuartersVisibility(sheetId)
  
  // Get all snapshots for this sheet
  const snapshots = await getAllQuarterSnapshots(sheetId)

  // Calculate live scores by quarter
  const goalsById = Object.fromEntries(goals.map((g) => [g._id, g]))
  const liveScoresByQuarter: Partial<Record<PeriodLabel, number>> = {}

  for (const ci of checkins) {
    if (!ACTIVE_PERIOD_LABELS.includes(ci.period_label)) continue
    const goal = goalsById[ci.goal_id]
    if (!goal) continue

    const uomType = goal.uom_type as UomType
    const achievementPct = calculateAchievementPercentage(uomType, ci.actual_value, goal.target_value)
    const goalScore = calculateGoalScore(achievementPct, goal.weightage)
    
    if (goalScore == null || isNaN(goalScore)) continue

    liveScoresByQuarter[ci.period_label] = (liveScoresByQuarter[ci.period_label] ?? 0) + goalScore
  }

  // Build quarter score points using centralized visibility resolution
  const quarterScores: QuarterScorePoint[] = []

  for (const visibility of visibilitySet.quarters) {
    const quarter = visibility.quarter_label as PeriodLabel
    
    // Skip quarters that are not visible
    if (!visibility.is_visible) {
      continue
    }

    const snapshot = snapshots.get(quarter)
    const liveScore = liveScoresByQuarter[quarter] ?? null

    // Resolve score using snapshot-aware priority
    const resolvedScore = resolveScoreWithPriority(
      snapshot?.overall_score ?? null,
      liveScore,
      visibility.is_visible,
      visibility.use_snapshot
    )

    // Only include quarters with valid scores
    if (resolvedScore !== null && !isNaN(resolvedScore)) {
      quarterScores.push({
        quarter,
        score: Math.round(resolvedScore * 10) / 10,
        isSnapshot: visibility.use_snapshot,
        isVisible: visibility.is_visible
      })
    }
  }

  return quarterScores
}

/** 
 * Legacy function for backward compatibility.
 * 
 * WARNING: This function only uses live scoring and simple window visibility.
 * Use buildQuarterlyScoresWithSnapshots() for complete snapshot-aware resolution.
 */
export function buildQuarterlyScores(goals: Goal[], checkins: CheckIn[]): QuarterScorePoint[] {
  const goalsById = Object.fromEntries(goals.map((g) => [g._id, g]))
  const totals: Partial<Record<PeriodLabel, number>> = {}
  const counts: Partial<Record<PeriodLabel, number>> = {}

  for (const ci of checkins) {
    if (!ACTIVE_PERIOD_LABELS.includes(ci.period_label)) continue
    const goal = goalsById[ci.goal_id]
    if (!goal) continue

    // Use the new scoring authority formulas
    const uomType = goal.uom_type as UomType
    const achievementPct = calculateAchievementPercentage(uomType, ci.actual_value, goal.target_value)
    const goalScore = calculateGoalScore(achievementPct, goal.weightage)
    
    if (goalScore == null || isNaN(goalScore)) continue

    totals[ci.period_label] = (totals[ci.period_label] ?? 0) + goalScore
    counts[ci.period_label] = (counts[ci.period_label] ?? 0) + 1
  }

  return ACTIVE_PERIOD_LABELS.filter((q) => (counts[q] ?? 0) > 0).map((q) => ({
    quarter: q,
    score: Math.round((totals[q] ?? 0) * 10) / 10,
    isSnapshot: false,
    isVisible: true
  }))
}
