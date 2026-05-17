# Validation Rules

## Goal Rules
- Total goal weightage must equal exactly 100%
- Minimum weightage per goal = 10%
- Maximum goals per employee = 8

## Goal Locking
- Approved goals become locked
- Employees cannot edit locked goals
- Only Admin can unlock

## Shared Goal Rules
- Employees may only edit weightage
- Goal title and target remain read-only

## UoM Types (Unit of Measure)
Every goal has one of four UoM types. Each type has a single canonical formula
for the **achievement %** of a check-in's actual value against the goal target.
The **goal score** for the quarter is always:

```
goal_score = (achievement_pct / 100) * weightage
```

### 1. Max — "higher is better"
Used when a larger Actual outperforms the Target (e.g. revenue, conversions).

```
achievement_pct = min(100, (Actual / Target) * 100)              if Target > 0
achievement_pct = 0                                              if Target <= 0 or Actual is missing
```

### 2. Min — "lower is better"
Used when a smaller Actual outperforms the Target (e.g. defects, downtime, cost).

```
achievement_pct = 100                                            if Actual <= 0
achievement_pct = min(100, (Target / Actual) * 100)              if Actual > 0 and Target >= 0
```

### 3. Timeline — "on-time vs. target date"
Target is an ISO date string (`YYYY-MM-DD`). Actual is the date the work was completed.

```
delivered_on_or_before_target  ⇒ achievement_pct = 100
delivered_after_target         ⇒ achievement_pct = max(0, 100 - days_late * 5)
not_delivered                  ⇒ achievement_pct = 0
```

A 5-point penalty per day late means a goal is fully missed after 20 days.

### 4. Zero — binary outcome
Target is "Yes" or "No". Actual is "Yes" or "No".

```
Actual == Target               ⇒ achievement_pct = 100
Actual != Target               ⇒ achievement_pct = 0
```

### Legacy "Numeric"
The legacy `Numeric` UoM type is treated identically to **Max** for backward
compatibility with existing goal sheets.
