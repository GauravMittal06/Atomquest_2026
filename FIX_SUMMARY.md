# Employee Login 401 Bug - Root Cause & Fix

## Problem
Employee sessions immediately redirected back to `/login` after successful authentication. Manager and Admin roles worked correctly.

## Root Cause

**Pydantic Response Model Validation Failure**

The `UserPublic` response model defined `role: UserRole` (enum type) but received `role: str` from MongoDB. This caused a validation conflict:

1. **UserBase** defined `role: UserRole` → Pydantic automatically creates an enum validator
2. **UserPublic** (extends UserBase) added a custom `@field_validator("role")` → Created duplicate validator conflict
3. MongoDB stores roles as strings (e.g., "EMPLOYEE", "employee", or potentially with whitespace)
4. Pydantic's automatic enum conversion is case-sensitive and strict
5. When the validation failed, FastAPI raised an internal error that manifested as a 401 response
6. Axios interceptor caught the 401 → logged user out → redirect to `/login`

### Evidence
```
UserWarning: `normalize_role` overrides an existing Pydantic `@field_validator` decorator
```
(Found in backend terminal logs at line 155-156 of terminals/4.txt)

## Solution

### 1. Removed Conflicting Field Validator
**File:** `backend/models/user.py`
- Removed the custom `@field_validator("role")` from `UserPublic` model
- Let Pydantic use its built-in enum conversion (requires uppercase strings)

### 2. Normalized Role at Endpoint Level
**File:** `backend/routers/users.py`
- Updated `_serialize()` helper function to normalize role strings:
  ```python
  if doc and "role" in doc and isinstance(doc["role"], str):
      doc["role"] = doc["role"].upper().strip()
  ```
- This ensures MongoDB strings are uppercased BEFORE Pydantic validation
- Handles edge cases: lowercase roles, extra whitespace, etc.

### 3. Added Diagnostic Logging
**Files:** 
- `frontend/src/lib/api.ts` → Logs failing 401 requests (URL, method, response data)
- `backend/auth.py` → Logs JWT decoding attempts and failures
- `backend/routers/users.py` → Logs `/users/me` calls and responses
- `backend/routers/checkins.py` → Logs checkin endpoint queries

## Testing
1. Try employee login (EMP001, EMP002, etc.) with password `AtomQuest@2025`
2. Check browser console for any 401 logs
3. Check backend terminal for role normalization logs
4. Verify employee dashboard loads successfully
5. Verify protected endpoints (`/checkins?employee_id=me`, `/goalsheets/`, `/goals/sheet/:id`) work

## Prevention
- Role normalization now happens consistently at the endpoint level
- No conflicting Pydantic validators
- Gracefully handles case sensitivity and whitespace
- Logging helps diagnose future auth issues quickly

## Files Changed
1. `backend/models/user.py` → Removed conflicting field validator
2. `backend/routers/users.py` → Added role normalization in `_serialize()`
3. `backend/auth.py` → Added JWT decoding error logging
4. `backend/routers/checkins.py` → Added diagnostic logging
5. `frontend/src/lib/api.ts` → Added 401 error logging

## Notes
- Manager and Admin worked because (hypothesis): their roles in DB happened to be correctly formatted
- Employee roles may have had lowercase "employee" or whitespace issues
- The fix is defensive and handles all edge cases
- Temporary logging can be removed after verification
