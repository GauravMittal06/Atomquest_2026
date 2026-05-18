import { calculateAchievementPercentage, calculateGoalScore, UomType } from '@/utils/scoring'
import { ACTIVE_PERIOD_LABELS, type CheckIn, type Goal, type PeriodLabel } from '@/types'

export interface QuarterScorePoint {
  quarter: PeriodLabel
  score: number
}

/** Aggregate weighted score (0–100) per quarter from filed check-ins. */
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
  }))
}
