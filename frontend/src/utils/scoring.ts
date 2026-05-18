/**
 * Scoring Authority for AtomQuest Goal Tracking Portal
 * 
 * This module contains the canonical scoring formulas for all UoM (Unit of Measure) types.
 * These formulas calculate achievement percentages and goal scores according to the
 * business rules defined in docs/VALIDATION_RULES.md.
 * 
 * The goal score for any goal is always:
 * goal_score = (achievement_pct / 100) * weightage
 */

/**
 * Unit of Measure types for goal scoring
 */
export enum UomType {
  MAX = "Max",
  MIN = "Min", 
  TIMELINE = "Timeline",
  ZERO = "Zero",
  NUMERIC = "Numeric"  // Legacy type, treated as MAX
}

/**
 * Calculate achievement percentage based on UoM type and actual vs target values.
 * 
 * @param uomType The Unit of Measure type
 * @param actual The actual value achieved (can be numeric, date string, or Yes/No)
 * @param target The target value (can be numeric, date string, or Yes/No)
 * @returns Achievement percentage (0-100)
 */
export function calculateAchievementPercentage(
  uomType: UomType,
  actual: number | string | null | undefined,
  target: number | string
): number {
  if (uomType === UomType.MAX || uomType === UomType.NUMERIC) {
    return calculateMaxAchievement(actual, target);
  } else if (uomType === UomType.MIN) {
    return calculateMinAchievement(actual, target);
  } else if (uomType === UomType.TIMELINE) {
    return calculateTimelineAchievement(actual, target);
  } else if (uomType === UomType.ZERO) {
    return calculateZeroAchievement(actual, target);
  } else {
    throw new Error(`Unknown UoM type: ${uomType}`);
  }
}

/**
 * Max UoM: "higher is better"
 * Used when a larger Actual outperforms the Target (e.g. revenue, conversions).
 * 
 * Formula:
 * achievement_pct = min(100, (Actual / Target) * 100)  if Target > 0
 * achievement_pct = 0                                  if Target <= 0 or Actual is missing
 */
function calculateMaxAchievement(actual: number | string | null | undefined, target: number | string): number {
  if (actual == null || target <= 0) {
    return 0;
  }

  try {
    const actualNum = Number(actual);
    const targetNum = Number(target);
    
    if (isNaN(actualNum) || isNaN(targetNum) || targetNum === 0) {
      return 0;
    }
    
    return Math.min(100, (actualNum / targetNum) * 100);
  } catch {
    return 0;
  }
}

/**
 * Min UoM: "lower is better"
 * Used when a smaller Actual outperforms the Target (e.g. defects, downtime, cost).
 * 
 * Formula:
 * achievement_pct = 100                                if Actual <= 0
 * achievement_pct = min(100, (Target / Actual) * 100)  if Actual > 0 and Target >= 0
 */
function calculateMinAchievement(actual: number | string | null | undefined, target: number | string): number {
  if (actual == null) {
    return 0;
  }

  try {
    const actualNum = Number(actual);
    const targetNum = Number(target);
    
    if (isNaN(actualNum) || isNaN(targetNum)) {
      return 0;
    }

    if (actualNum <= 0) {
      return 100;
    }

    if (actualNum > 0 && targetNum >= 0) {
      return Math.min(100, (targetNum / actualNum) * 100);
    }

    return 0;
  } catch {
    return 0;
  }
}

/**
 * Timeline UoM: "on-time vs. target date"
 * Target is an ISO date string (YYYY-MM-DD). Actual is the date work was completed.
 * 
 * Formula:
 * delivered_on_or_before_target  => achievement_pct = 100
 * delivered_after_target         => achievement_pct = max(0, 100 - days_late * 5)
 * not_delivered                  => achievement_pct = 0
 * 
 * A 5-point penalty per day late means a goal is fully missed after 20 days.
 */
function calculateTimelineAchievement(actual: number | string | null | undefined, target: number | string): number {
  if (actual == null || actual === "") {
    return 0; // not delivered
  }

  try {
    // Parse ISO date strings
    const targetDate = new Date(String(target).replace('Z', ''));
    const actualDate = new Date(String(actual).replace('Z', ''));
    
    if (isNaN(targetDate.getTime()) || isNaN(actualDate.getTime())) {
      return 0;
    }

    if (actualDate <= targetDate) {
      return 100; // delivered on or before target
    }

    // Calculate days late
    const daysLate = Math.floor((actualDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 100 - daysLate * 5);
    
  } catch {
    return 0;
  }
}

/**
 * Zero UoM: binary outcome
 * Target is "Yes" or "No". Actual is "Yes" or "No".
 * 
 * Formula:
 * Actual == Target  => achievement_pct = 100
 * Actual != Target  => achievement_pct = 0
 */
function calculateZeroAchievement(actual: number | string | null | undefined, target: number | string): number {
  if (actual == null) {
    return 0;
  }

  try {
    const actualStr = String(actual).trim();
    const targetStr = String(target).trim();
    
    return actualStr === targetStr ? 100 : 0;
  } catch {
    return 0;
  }
}

/**
 * Calculate the goal score for the quarter.
 * 
 * Formula:
 * goal_score = (achievement_pct / 100) * weightage
 * 
 * @param achievementPct Achievement percentage (0-100)
 * @param weightage Goal weightage (0-100)
 * @returns Goal score (0 to weightage value)
 */
export function calculateGoalScore(achievementPct: number, weightage: number): number {
  return (achievementPct / 100) * weightage;
}

/**
 * Calculate total score by summing all individual goal scores.
 * 
 * @param goalScores List of individual goal scores
 * @returns Total score (0-100 when all weightages sum to 100%)
 */
export function calculateTotalScore(goalScores: number[]): number {
  return goalScores.reduce((sum, score) => sum + score, 0);
}

// Validation helpers

/**
 * Validate that total goal weightage equals exactly 100%
 */
export function validateTotalWeightage(weightages: number[]): boolean {
  const total = weightages.reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 100) < 0.01; // Allow for floating point precision
}

/**
 * Validate that individual goal weightage is at least 10%
 */
export function validateIndividualWeightage(weightage: number): boolean {
  return weightage >= 10;
}

/**
 * Validate that employee has maximum 8 goals
 */
export function validateMaxGoals(goalCount: number): boolean {
  return goalCount <= 8;
}

// Display formatting utilities

/**
 * Format score for display with proper null handling.
 * Returns "—" for null/undefined scores to avoid showing 0, NaN, or stale values.
 * 
 * @param score The score value (can be null/undefined)
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted score string or "—" for null values
 */
export function formatScore(score?: number | null, decimals: number = 1): string {
  if (score == null || isNaN(score)) {
    return '—';
  }
  return score.toFixed(decimals);
}

/**
 * Format score with suffix for display.
 * 
 * @param score The score value (can be null/undefined)
 * @param suffix The suffix to append (e.g., " pts", " / 100")
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted score with suffix or "—" for null values
 */
export function formatScoreWithSuffix(score?: number | null, suffix: string = '', decimals: number = 1): string {
  if (score == null || isNaN(score)) {
    return '—';
  }
  return `${score.toFixed(decimals)}${suffix}`;
}

/**
 * Check if a score should be displayed (not null, not NaN, not stale).
 * 
 * @param score The score value to check
 * @returns True if score can be displayed, false otherwise
 */
export function isValidScore(score?: number | null): boolean {
  return score != null && !isNaN(score);
}

// Snapshot-aware scoring utilities

/**
 * Resolve score for display with snapshot-aware priority.
 * 
 * Priority order:
 * 1. Frozen snapshot score (mock-date independent)
 * 2. Active live score (current quarter only)
 * 3. null (hidden quarters)
 * 
 * @param snapshotScore Frozen snapshot score (highest priority)
 * @param liveScore Computed live score (lower priority)
 * @param isVisible Whether quarter should be visible at all
 * @param useSnapshot Whether to prefer snapshot over live score
 * @returns Resolved score or null for hidden quarters
 */
export function resolveScoreWithPriority(
  snapshotScore: number | null,
  liveScore: number | null,
  isVisible: boolean,
  useSnapshot: boolean
): number | null {
  // Hidden quarters always return null
  if (!isVisible) {
    return null
  }

  // Priority 1: Use snapshot score if available and preferred
  if (useSnapshot && snapshotScore != null && !isNaN(snapshotScore)) {
    return snapshotScore
  }

  // Priority 2: Use live score if available
  if (liveScore != null && !isNaN(liveScore)) {
    return liveScore
  }

  // Default: no valid score available
  return null
}

/**
 * Format score with snapshot-aware resolution and proper null handling.
 * 
 * @param snapshotScore Frozen snapshot score
 * @param liveScore Live computed score
 * @param isVisible Whether quarter is visible
 * @param useSnapshot Whether to prefer snapshot
 * @param decimals Number of decimal places
 * @returns Formatted score string or "—" for null/hidden
 */
export function formatScoreWithPriority(
  snapshotScore: number | null,
  liveScore: number | null,
  isVisible: boolean,
  useSnapshot: boolean,
  decimals: number = 1
): string {
  const resolvedScore = resolveScoreWithPriority(
    snapshotScore,
    liveScore,
    isVisible,
    useSnapshot
  )
  return formatScore(resolvedScore, decimals)
}