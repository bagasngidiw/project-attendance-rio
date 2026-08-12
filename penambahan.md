Read `Project.txt` completely before doing anything.

DO NOT read `BACKLOG.md`.

Before designing anything, inspect the existing repository thoroughly.

You are acting as the Senior Software Lead Designer

IMPORTANT:
- DO NOT write implementation code.
- DO NOT modify source code.
- DO NOT implement the feature.
- DO NOT create arbitrary files.
- Your responsibility is ONLY to analyze the requirements and produce a highly detailed technical/UI/UX breakdown.
- Write the complete breakdown into `TODO.md`.
- The breakdown MUST be structured as Feature Requests (`FR-XXX`).
- The Developer Agent must later be able to implement the feature directly from `TODO.md`.
- Inspect the existing implementation before making architectural decisions.
- Do NOT rebuild the entire application.
- Do NOT rewrite unrelated modules.
- Do NOT break existing RBAC.
- Do NOT break authentication.
- Do NOT create duplicate systems when an existing system can be reused.

==================================================
ADDITIONAL FEATURE REQUIREMENT
EMPLOYEE WORKING SCHEDULE
==================================================

Add employee-specific working schedule configuration to the existing User module.

This schedule will become the source of truth for determining the employee's expected working time.

The schedule consists ONLY of:

1. Working Days
2. Working Start Time
3. Working End Time

Do NOT introduce break schedules, shift management, overtime schedules, holiday calendars, or other scheduling systems unless they already exist in the repository and are required for compatibility.

==================================================
FR-XXX: EMPLOYEE WORKING DAYS
==================================================

Add working-day configuration to the User module.

LOCATION:

Pengguna > Buat Pengguna Baru

AND:

Pengguna > Edit Pengguna

The administrator must be able to configure which days the employee is expected to work.

The UI must provide individual checkboxes for:

- Senin
- Selasa
- Rabu
- Kamis
- Jumat
- Sabtu
- Minggu

Example:

Hari Kerja

☑ Senin
☑ Selasa
☑ Rabu
☑ Kamis
☑ Jumat
☐ Sabtu
☐ Minggu

The configuration must belong to the employee/user.

Do NOT assume every employee works Monday-Friday.

Example:

Employee A:

Senin ✓
Selasa ✓
Rabu ✓
Kamis ✓
Jumat ✓
Sabtu ✗
Minggu ✗

Employee B:

Senin ✓
Selasa ✓
Rabu ✓
Kamis ✓
Jumat ✓
Sabtu ✓
Minggu ✗

Both configurations must be valid.

The system must store the selected working days as part of the employee's work schedule configuration.

==================================================
FR-XXX: EMPLOYEE WORKING HOURS
==================================================

Add working-hour configuration to the User module.

LOCATION:

Pengguna > Buat Pengguna Baru

AND:

Pengguna > Edit Pengguna

The UI must provide:

Jam Kerja

[ 08:00 ] - [ 17:00 ]

Conceptually:

Working Start Time
Working End Time

Example:

Jam Masuk:
08:00

Jam Pulang:
17:00

The system must validate:

1. Start time must be a valid time.
2. End time must be a valid time.
3. End time must be after start time.
4. Empty values must be handled according to the existing validation architecture.
5. Invalid schedules must not be saved.
6. The UI must clearly communicate validation errors.

Do NOT introduce break configuration.

Do NOT introduce shift configuration.

Do NOT introduce multiple schedules per employee unless the existing architecture already supports it.

For this requirement, the employee has:

Working Days
+
Working Start Time
+
Working End Time

==================================================
FR-XXX: USER CREATE AND EDIT CONSISTENCY
==================================================

The working schedule configuration must be available in BOTH:

Pengguna > Buat Pengguna Baru

AND:

Pengguna > Edit Pengguna

The two forms must use the same underlying business concept and data model.

Do NOT create:

- one schedule structure for Create User
- another schedule structure for Edit User

Both must modify the same employee working schedule.

When editing an existing employee:

- Load the employee's current working days.
- Load the employee's current working start time.
- Load the employee's current working end time.
- Do not reset existing values unintentionally.
- Only modify values explicitly changed by the administrator.

The UI should clearly group these fields under something such as:

Jadwal Kerja

Hari Kerja
[checkboxes]

Jam Kerja
[start time] - [end time]

==================================================
FR-XXX: WORKING SCHEDULE DATA MODEL
==================================================

Use the existing MongoDB/Mongoose architecture and conventions.

Do NOT create an unnecessary separate database architecture.

Conceptually, the employee configuration should support:

User
 |
 +-- Working Schedule
       |
       +-- Working Days
       |     +-- Monday
       |     +-- Tuesday
       |     +-- Wednesday
       |     +-- Thursday
       |     +-- Friday
       |     +-- Saturday
       |     +-- Sunday
       |
       +-- Working Start Time
       |
       +-- Working End Time

The exact field naming must follow the existing project's naming conventions.

The Designer must inspect the current User model/schema before defining the final structure.

The schedule should be represented in a way that is:

- deterministic
- easy to validate
- easy for the Attendance module to consume
- compatible with MongoDB/Mongoose
- extensible without creating unnecessary complexity

==================================================
FR-XXX: ATTENDANCE USES EMPLOYEE WORKING SCHEDULE
==================================================

The Absensi module must consume the employee's configured working schedule.

This is a critical business rule.

Do NOT hardcode attendance timing such as:

08:00
09:00
Monday-Friday

inside the Attendance module.

The employee's configured schedule is the source of truth for the employee's expected working time.

Conceptually:

USER
  |
  +-- Working Days
  |
  +-- Working Start Time
  |
  +-- Working End Time
          |
          ↓
       ABSENSI
          |
          ↓
Compare actual attendance
against expected schedule
          |
          ↓
Attendance Status

The Attendance module must retrieve the applicable employee schedule when evaluating attendance.

==================================================
FR-XXX: ATTENDANCE WORKING-DAY VALIDATION
==================================================

Attendance must respect the employee's configured working days.

Example:

Employee configuration:

Monday ✓
Tuesday ✓
Wednesday ✓
Thursday ✓
Friday ✓
Saturday ✗
Sunday ✗

Then:

Monday:
Working day

Tuesday:
Working day

Friday:
Working day

Saturday:
Non-working day

Sunday:
Non-working day

The Attendance module must NOT automatically treat a non-working day as a normal late attendance day.

Example:

Employee does not work Saturday.

Saturday 08:15

This must NOT automatically produce:

TERLAMBAT

because Saturday is not configured as a working day.

The Designer must inspect the existing attendance status architecture and determine the correct behavior for non-working days.

If the existing system already has a status for:

- Non-working day
- Hari Libur
- Tidak Dijadwalkan
- Absent
- etc.

reuse the existing concept instead of creating a duplicate status.

If no suitable status exists, define the appropriate conceptual behavior in `TODO.md`.

==================================================
FR-XXX: ATTENDANCE WORKING-HOUR VALIDATION
==================================================

Attendance must compare the actual attendance time against the employee's configured working hours.

Example:

Employee schedule:

Working Days:
Monday-Friday

Working Hours:
08:00 - 17:00

Clock-in:

07:55
→ TEPAT WAKTU

08:00
→ TEPAT WAKTU

08:01
→ TERLAMBAT

08:30
→ TERLAMBAT

09:00
→ TERLAMBAT

The comparison must use the employee's actual configured schedule.

Do NOT hardcode:

08:00

as a global attendance threshold.

Different employees may have different schedules.

Example:

Employee A:
08:00 - 17:00

Employee B:
09:00 - 18:00

Employee C:
07:30 - 16:30

Each employee must be evaluated according to their own schedule.

==================================================
FR-XXX: ATTENDANCE STATUS
==================================================

The Attendance module must automatically determine the appropriate attendance status based on the employee's configured working schedule.

At minimum, the system must support:

TEPAT WAKTU

and:

TERLAMBAT

Example:

Expected start:
08:00

Actual clock-in:
07:55

Status:
TEPAT WAKTU

Expected start:
08:00

Actual clock-in:
08:01

Status:
TERLAMBAT

The employee must NOT manually select:

"Tepat Waktu"

or:

"Terlambat"

The status is determined by the Attendance business logic.

IMPORTANT:

Before introducing new statuses, inspect the existing Attendance implementation.

If the existing system already has statuses such as:

- Absent
- Early
- Leave
- Sick
- Permission
- Holiday
- Non-working day
- etc.

preserve and integrate them.

Do NOT create duplicate status concepts.

==================================================
FR-XXX: ATTENDANCE ADJUSTMENT RESPONSIBILITY
==================================================

Attendance adjustment belongs exclusively to the Absensi domain.

Do NOT put attendance adjustment functionality inside:

- User
- Cuti
- Sakit
- Ijin

The User module defines the employee's EXPECTED working schedule.

The Attendance module determines the employee's ACTUAL attendance and evaluates it against that schedule.

Conceptually:

USER CONFIGURATION
        |
        +-- Working Days
        |
        +-- Working Start Time
        |
        +-- Working End Time
        |
        ↓
     EXPECTED SCHEDULE
        |
        ↓
      ABSENSI
        |
        +-- Actual Clock-in
        |
        +-- Actual Clock-out
        |
        ↓
Compare actual vs expected
        |
        +-- Tepat Waktu
        +-- Terlambat
        +-- Existing applicable statuses
        |
        ↓
    ADJUSTMENT

If an attendance record needs to be corrected, the adjustment must be performed through the Attendance module and follow the existing RBAC and audit architecture.

The User module must NOT contain attendance correction functionality.

==================================================
FR-XXX: HISTORICAL ATTENDANCE INTEGRITY
==================================================

The Designer must consider what happens when an administrator changes an employee's working schedule.

Example:

Employee schedule:

08:00 - 17:00

Attendance on August 10:

08:10
→ TERLAMBAT

Later, administrator changes the employee schedule to:

09:00 - 18:00

The previous August 10 attendance MUST NOT silently change from:

TERLAMBAT

to:

TEPAT WAKTU

because historical attendance must remain consistent with the schedule/business context used when it was evaluated.

The Designer must determine the appropriate strategy, such as storing the relevant schedule snapshot/context on the attendance record.

The final technical breakdown must explicitly define how historical attendance integrity is preserved.

==================================================
FR-XXX: TIMEZONE AND TIME VALIDATION
==================================================

The Designer must inspect the existing application's timezone architecture.

The working hours and attendance timestamps must be interpreted consistently.

The technical breakdown must define:

- How working hours are stored.
- How attendance timestamps are stored.
- Which timezone is authoritative.
- How the UI displays time.
- How comparisons between expected and actual time are performed.
- How date boundaries are handled.

Do NOT introduce a new timezone architecture if the project already has one.

Reuse the existing architecture where possible.

==================================================
FR-XXX: EDGE CASES
==================================================

The technical breakdown MUST explicitly cover:

1. Employee has no working days selected.
2. Employee has only one working day.
3. Employee works Monday-Saturday.
4. Employee works Monday-Sunday.
5. Employee has different working hours from another employee.
6. Start time equals end time.
7. End time is earlier than start time.
8. Invalid time format.
9. Missing working schedule.
10. Attendance on a configured working day.
11. Attendance on a non-working day.
12. Clock-in exactly at start time.
13. Clock-in before start time.
14. Clock-in after start time.
15. Employee schedule changed after historical attendance exists.
16. Attendance adjustment after schedule change.
17. Employee is newly created without a schedule.
18. Employee schedule is edited.
19. Duplicate attendance submissions.
20. Timezone/date boundary scenarios.

==================================================
REQUIRED TODO.md OUTPUT
==================================================

After analyzing the repository and existing architecture, write the complete technical breakdown into:

TODO.md

Do NOT simply copy this instruction into TODO.md.

Transform the requirements into implementation-ready technical design tasks.

Use the next appropriate FR numbers based on the existing TODO.md conventions.

Each FR must contain:

1. Objective
2. Existing feature affected
3. UI/UX changes
4. User flow
5. Business rules
6. Data model requirements
7. API requirements
8. Validation
9. RBAC requirements
10. Error states
11. Edge cases
12. Security considerations
13. Audit requirements where applicable
14. Historical data considerations
15. Acceptance criteria
16. Dependencies

IMPORTANT:

The Designer must inspect the existing repository before deciding the final technical structure.

Do not blindly assume that the current architecture matches the conceptual model above.

Reuse existing:

- User architecture
- MongoDB/Mongoose conventions
- Attendance architecture
- RBAC
- Authentication
- API conventions
- Validation
- Audit system
- Existing status system

Do not introduce duplicate systems.

Do not write implementation code.

TODO.md must contain technical design and implementation instructions only.

Before finishing, review TODO.md for:

- Contradictory requirements
- Ambiguous business rules
- Duplicate functionality
- Missing validation
- Missing edge cases
- Incorrect module ownership
- Potential historical-data corruption
- RBAC conflicts
- Unnecessary architectural complexity

The final TODO.md must be detailed enough that the Developer Agent can implement the working-days and working-hours system without having to reinterpret the original requirement.