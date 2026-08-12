REVAMP ABSENSI — CAMERA, LOCATION & DEVICE INFORMATION

Read `Project.txt` completely before doing anything.

Inspect the existing Absensi implementation thoroughly before making any design or implementation decision.

IMPORTANT:
Do NOT rebuild the entire Absensi module.
Do NOT rewrite unrelated modules.
Do NOT break existing authentication.
Do NOT break existing RBAC.
Do NOT create a second attendance system.

The current Absensi page has camera and location functionality, but both are still buggy and not reliably usable.

The first provided screenshot represents the CURRENT implementation.

The second provided screenshot represents the TARGET UX/BEHAVIOR that I want.

The goal is to REVAMP the existing Absensi verification experience so that the camera, location, device information, working schedule, and attendance submission work reliably as one complete flow.

==================================================
1. CAMERA VERIFICATION
==================================================

The Absensi module must provide a real browser camera verification experience.

The camera must:

- Request camera permission only when the user is inside the Absensi module.
- Use the browser's camera permission mechanism.
- Work on supported:
  - Mobile phones
  - Laptops
  - Desktop computers with webcams
- Display the live camera preview clearly.
- Allow the user to capture their attendance photo.
- Display the captured photo after capture.
- Allow the user to retake the photo before submitting.
- Prevent submission if the required camera verification has not been completed.
- Handle camera permission denial gracefully.
- Handle browsers/devices without a camera gracefully.
- Handle camera initialization failure gracefully.
- Provide a clear loading state while the camera is initializing.
- Provide a clear error state if the camera cannot be accessed.

The camera must NOT merely display a placeholder.

It must use the actual browser MediaDevices/camera capability already available in modern browsers.

==================================================
2. CAMERA LIFECYCLE — VERY IMPORTANT
==================================================

The camera MUST ONLY be active while the user is actively using the Absensi module.

When the user:

- Navigates from Absensi → Dashboard
- Navigates from Absensi → Cuti
- Navigates from Absensi → Sakit
- Navigates from Absensi → Ijin
- Navigates from Absensi → Lembur
- Navigates to any other module
- Leaves the page
- Refreshes the page
- Closes the relevant Absensi view

the camera stream MUST be stopped.

The browser camera must NOT continue running in the background.

The implementation must properly release all active MediaStream tracks when the Absensi component/page is unmounted or otherwise becomes inactive.

The camera must never remain active merely because the user previously granted permission.

IMPORTANT:

Camera permission ≠ active camera stream.

The application may remember that permission was granted by the browser, but it must NOT keep the camera stream running outside the Absensi module.

When the user returns to Absensi, the application may request/start the camera again when the user explicitly initiates camera verification.

==================================================
3. CAMERA UI
==================================================

Use the second screenshot as the UX reference.

The camera verification area should feel like a dedicated verification container.

Recommended structure:

CAMERA / FOTO KEBERADAAN
    ↓
Live camera preview
    ↓
Capture button
    ↓
Captured photo preview
    ↓
Retake option if required

The user must clearly understand:

- Whether the camera is active.
- Whether a photo has been captured.
- Whether the photo is ready for submission.
- Whether camera permission is missing.
- Whether the camera failed.

Do not make the user guess what state the camera is currently in.

==================================================
4. LOCATION VERIFICATION
==================================================

The Absensi module must also retrieve the user's current location using the browser's Geolocation API.

Location must:

- Request location permission from the user.
- Retrieve the current latitude.
- Retrieve the current longitude.
- Display the user's detected position visually on a map.
- Display a clear "Lokasi Anda" marker.
- Show the location status.
- Show a loading state while location is being determined.
- Show an error state if permission is denied.
- Show an error state if location cannot be determined.
- Allow the user to retry location detection.

Do NOT fake the location.

Do NOT hardcode coordinates.

Do NOT use a random/default location as if it were the user's actual location.

==================================================
5. LOCATION ACCURACY
==================================================

Use the browser geolocation capabilities appropriately for attendance verification.

The implementation should request a reasonably accurate position rather than intentionally using a coarse location.

The system should capture at minimum:

- Latitude
- Longitude
- Accuracy in meters
- Timestamp of location acquisition

The frontend should communicate the detected accuracy to the backend.

The backend must remain the source of truth for attendance validation.

Do NOT claim that browser GPS can guarantee perfect physical accuracy.

The system should instead record the actual accuracy reported by the device/browser.

Example:

Latitude:
-6.xxxxx

Longitude:
106.xxxxx

Accuracy:
25 meters

Detected at:
10:15:20

==================================================
6. LOCATION MAP
==================================================

The location area should visually resemble the second screenshot.

Structure:

LOKASI ANDA SEKARANG
    ↓
Map container
    ↓
Current-location marker
    ↓
Location status
    ↓
Retry / refresh location action

The map must update when a new valid location is obtained.

Do not display a map that is unrelated to the actual detected coordinates.

If the existing project already has a mapping implementation/library, inspect and reuse it.

Do NOT introduce a completely different mapping architecture without a reason.

==================================================
7. DEVICE INFORMATION
==================================================

Create a completely separate container for device information.

It must NOT be mixed into the camera or location container.

Use an expandable/collapsible container similar to the second screenshot.

Example:

┌─────────────────────────────────────────────┐
│ ℹ  Info Perangkat                           │
│    Absensi via Laptop/PC (Kamera & GPS)  ˅ │
└─────────────────────────────────────────────┘

When collapsed:
- Only show the summary.

When expanded:
- Show useful device/browser information that the application can reliably determine.

Possible information:

- Device category
- Browser
- Operating system
- Camera availability
- Location availability
- Camera permission state where browser APIs expose it
- Location permission state where browser APIs expose it

Do NOT expose unnecessary sensitive device information.

Do NOT attempt to fingerprint the user.

The purpose is operational information for attendance verification, not tracking.

==================================================
8. ABSENSI VERIFICATION FLOW
==================================================

The complete UX should follow a clear sequence:

USER OPENS ABSENSI
        ↓
Show device information
        ↓
Show camera verification
        ↓
Show location verification
        ↓
User grants camera permission
        ↓
Camera becomes active
        ↓
User captures photo
        ↓
User grants location permission
        ↓
Location is detected
        ↓
Location displayed on map
        ↓
Camera + Photo + Location ready
        ↓
Attendance submission becomes available
        ↓
Submit attendance
        ↓
Backend validates request
        ↓
Attendance record is created
        ↓
UI updates with successful attendance state

Do not require the user to repeatedly perform unnecessary actions.

==================================================
9. CAMERA + LOCATION READINESS
==================================================

The attendance submission action must only become available when all mandatory verification requirements have been satisfied.

For example:

Camera:
✓ Ready

Photo:
✓ Captured

Location:
✓ Detected

Then:

[Absen Masuk]

If camera/photo/location is incomplete:

[Absen Masuk] must remain unavailable or clearly indicate what is missing.

The user must receive an explicit explanation such as:

"Lengkapi verifikasi kamera dan lokasi terlebih dahulu."

Do not silently fail.

==================================================
10. ATTENDANCE DATA
==================================================

The attendance submission must send the required verification information to the backend.

The exact existing Attendance model/API must be inspected first.

Do not create duplicate attendance entities if an existing one already exists.

Where supported by the existing architecture, attendance verification data should include:

- User ID / authenticated user
- Attendance type
- Timestamp
- Captured attendance photo
- Latitude
- Longitude
- Location accuracy
- Location timestamp
- Relevant verification metadata

The backend must validate the authenticated user.

Do NOT trust a user ID sent by the frontend if the authenticated identity is already available through the authentication system.

==================================================
11. CLOCK-IN / CLOCK-OUT
==================================================

Preserve the existing business requirement:

The user should NOT manually enter a clock-in or clock-out time.

The system must automatically generate the timestamp when the attendance request is successfully accepted by the backend.

The frontend must display:

Absen Masuk:
[server-generated timestamp]

Absen Keluar:
[server-generated timestamp]

Do not use the frontend device clock as the authoritative attendance timestamp.

The backend/server timestamp must be authoritative.

==================================================
12. WORKING SCHEDULE INTEGRATION
==================================================

The Absensi module must continue using the employee's configured:

- Working days
- Working start time
- Working end time

Do NOT hardcode:

08:00
09:00
Monday-Friday

The user's configured schedule is the source of truth.

Example:

Working schedule:
Monday-Friday
08:00-17:00

07:55 → TEPAT WAKTU
08:00 → TEPAT WAKTU
08:01 → TERLAMBAT

If today is not a configured working day, follow the existing non-working-day attendance rules.

Do not incorrectly mark the employee as TERLAMBAT on a non-working day.

==================================================
13. NAVIGATION / ROUTE SAFETY
==================================================

This is CRITICAL.

When leaving the Absensi route:

Camera stream MUST stop.

Location watching MUST stop if the implementation uses continuous location watching.

Any active timers related to verification MUST stop.

Any active event listeners related to camera/location MUST be cleaned up.

Any temporary resources must be released.

Returning to Absensi must initialize the required resources again safely.

Avoid:

- memory leaks
- duplicated camera streams
- duplicated geolocation watchers
- multiple active MediaStreams
- stale camera references
- stale location state
- camera continuing after navigation

==================================================
14. PERMISSION HANDLING
==================================================

The application must handle:

Camera permission:
- Granted
- Denied
- Prompt
- Unavailable

Location permission:
- Granted
- Denied
- Prompt
- Unavailable

The UI must clearly explain what the user needs to do.

Do not continuously spam permission requests.

If permission is denied, provide an appropriate retry/instruction flow.

==================================================
15. RESPONSIVE DESIGN
==================================================

The feature must work on:

- Desktop
- Laptop
- Tablet
- Mobile

On desktop:

Camera and location can appear side-by-side.

On smaller screens:

Camera and location should stack vertically.

The UI must remain usable without horizontal overflow.

==================================================
16. ERROR HANDLING
==================================================

Handle at minimum:

Camera unavailable
Camera permission denied
Camera initialization failure
Photo capture failure
Location unavailable
Location permission denied
Location timeout
Location accuracy too poor
Map loading failure
Network failure
Backend validation failure
Authentication failure
Unauthorized request
Duplicate attendance submission
Server error

Every error must have a user-readable message.

Do NOT expose raw technical errors to normal users.

==================================================
17. DESIGN REQUIREMENT
==================================================

Use the second screenshot as the visual/UX reference.

The design should contain:

1. Separate device information accordion/container.
2. Separate camera verification container.
3. Separate location verification container.
4. Clear verification states.
5. Clear capture action.
6. Clear location detection action.
7. Clear attendance submission action.
8. Clear success/error feedback.

Do not simply copy the screenshot blindly.

Adapt the design to the existing HRIS design system and reusable components.

==================================================
18. IMPORTANT IMPLEMENTATION RULE
==================================================

Do NOT treat the existing broken camera/location implementation as something that only needs CSS changes.

The current functionality is BUGGY.

Inspect the actual implementation and identify the root causes.

The solution must address:

- Camera lifecycle
- MediaStream cleanup
- Route unmount cleanup
- Permission handling
- Location acquisition
- Location accuracy
- State synchronization
- API integration
- Backend validation
- Attendance persistence

The goal is a REAL working attendance verification system.

==================================================
19. TESTING REQUIREMENT
==================================================

Before considering the task complete, test:

CAMERA
[ ] Camera permission request works.
[ ] Camera preview works.
[ ] Photo capture works.
[ ] Retake works.
[ ] Camera permission denial is handled.
[ ] Camera failure is handled.
[ ] Camera stops when leaving Absensi.
[ ] Camera starts correctly when returning to Absensi.
[ ] No duplicate camera streams occur.

LOCATION
[ ] Location permission request works.
[ ] Location is detected.
[ ] Latitude is correct.
[ ] Longitude is correct.
[ ] Accuracy is recorded.
[ ] Map displays the detected location.
[ ] Retry works.
[ ] Permission denial is handled.
[ ] Location timeout is handled.
[ ] Location watcher is stopped when leaving Absensi.

ATTENDANCE
[ ] Attendance cannot be submitted without required verification.
[ ] Photo is sent correctly.
[ ] Location is sent correctly.
[ ] Backend validates the authenticated user.
[ ] Backend generates the authoritative timestamp.
[ ] Attendance status uses the configured working schedule.
[ ] Clock-in is persisted correctly.
[ ] Clock-out is persisted correctly.
[ ] Duplicate submissions are handled.
[ ] Existing attendance history still works.

NAVIGATION
[ ] Camera stops when navigating to Dashboard.
[ ] Camera stops when navigating to Cuti.
[ ] Camera stops when navigating to Sakit.
[ ] Camera stops when navigating to Ijin.
[ ] Camera stops when navigating to Lembur.
[ ] Camera stops when navigating to any other module.
[ ] No background camera access remains.

RESPONSIVE
[ ] Desktop works.
[ ] Laptop works.
[ ] Tablet works.
[ ] Mobile works.

==================================================
20. TODO.md REQUIREMENT
==================================================

This is a technical design task.

DO NOT write implementation code.

Break this requirement down into one or more detailed Feature Requests inside `TODO.md`.

Each FR MUST contain a full-stack technical breakdown covering where applicable:

- Existing architecture affected
- MongoDB/Mongoose
- Backend
- API
- Authentication
- RBAC
- Business logic
- Camera lifecycle
- Geolocation lifecycle
- Frontend state
- React/Vite components
- UI/UX
- Validation
- Error handling
- Loading states
- Permission states
- Responsive behavior
- Testing
- Acceptance criteria
- Regression considerations

The Developer Agent will use `TODO.md` as the implementation blueprint.

Therefore, the breakdown must be detailed enough that the Developer Agent can implement the feature from backend through frontend without having to guess the intended behavior.

DO NOT write code in `TODO.md`.

DO NOT implement the feature yourself.

Your responsibility is to produce the complete technical implementation blueprint.