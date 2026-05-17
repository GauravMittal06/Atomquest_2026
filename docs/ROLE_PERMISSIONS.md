# Role Permissions

## Roles

The system defines exactly **three roles**:

| Role constant | Display Name | Description |
|---|---|---|
| `EMPLOYEE` | Employee | Front-line contributor; owns their Goal Sheet |
| `MANAGER` | Manager | Reviews and approves team Goal Sheets |
| `ADMIN` | Administrator | System-wide configuration and oversight |

---

## Permission Matrix

### Goal Sheet Permissions

| Action | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| Create Goal Sheet (own) | ✅ | ✅ (own) | ✅ |
| View own Goal Sheet | ✅ | ✅ | ✅ |
| View team Goal Sheets | ❌ | ✅ (direct reports) | ✅ (all) |
| View all Goal Sheets | ❌ | ❌ | ✅ |
| Edit Goal Sheet (Draft) | ✅ (own) | ✅ (own) | ✅ |
| Edit Goal Sheet (Returned) | ✅ (own) | ✅ (own) | ✅ |
| Submit Goal Sheet | ✅ (own) | ✅ (own) | ✅ |
| Approve Goal Sheet | ❌ | ✅ (team) | ✅ |
| Return Goal Sheet | ❌ | ✅ (team) | ✅ |
| Lock Goal Sheet | ❌ | ✅ (team, after approval) | ✅ |
| Delete Goal Sheet (Draft only) | ✅ (own) | ✅ (own) | ✅ |

### Goal Permissions

| Action | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| Add / Edit / Delete Goal | ✅ (own Draft/Returned sheet) | ✅ (own Draft/Returned sheet) | ✅ |
| View Goals | ✅ (own) | ✅ (own + team) | ✅ (all) |
| Mark goal as Shared | ✅ (own) | ✅ (own) | ✅ |

### Check-in Permissions

| Action | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| Add Check-in | ✅ (own Approved/Locked sheet) | ✅ (own) | ✅ |
| Edit Check-in | ✅ (own, same day only) | ✅ (own, same day only) | ✅ |
| View Check-ins | ✅ (own) | ✅ (own + team) | ✅ (all) |

### User Management Permissions

| Action | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| View own profile | ✅ | ✅ | ✅ |
| Edit own profile | ✅ (limited fields) | ✅ (limited fields) | ✅ |
| Create / Deactivate Users | ❌ | ❌ | ✅ |
| Assign roles | ❌ | ❌ | ✅ |
| Assign manager to employee | ❌ | ❌ | ✅ |
| View all users | ❌ | ✅ (own team) | ✅ |

### Configuration Permissions

| Action | EMPLOYEE | MANAGER | ADMIN |
|---|---|---|---|
| Manage Thrust Areas | ❌ | ❌ | ✅ |
| Manage Appraisal Periods | ❌ | ❌ | ✅ |
| Configure rating bands | ❌ | ❌ | ✅ |
| View reports | Own only | Team only | All |
| Export reports | ❌ | Team CSV | All CSV / PDF |

---

## Field-level Edit Restrictions by Role

### Employee — editable own profile fields
- `name`, `phone`, `profile_picture`

### Manager — editable own profile fields
- `name`, `phone`, `profile_picture`

### Admin — editable for any user
- All fields except `_id`, `created_at`

---

## API Endpoint Access Summary

All endpoints enforce JWT authentication. Role is embedded in the JWT payload.

| Endpoint prefix | Minimum role |
|---|---|
| `/api/users/me` | EMPLOYEE |
| `/api/goalsheets` (own) | EMPLOYEE |
| `/api/goalsheets/team` | MANAGER |
| `/api/goalsheets/all` | ADMIN |
| `/api/goals` | EMPLOYEE |
| `/api/checkins` | EMPLOYEE |
| `/api/admin/*` | ADMIN |
| `/api/reports/own` | EMPLOYEE |
| `/api/reports/team` | MANAGER |
| `/api/reports/all` | ADMIN |
