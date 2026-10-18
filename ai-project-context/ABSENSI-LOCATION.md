# Absensi Location Reporting

> This document records the implementation context for displaying attendance
> locations in the Laporan/Absensi preview and Excel export. Read it before
> changing attendance reporting, coordinate handling, or reverse geocoding.

## 1. Why this exists

The client reported that the Absensi Excel export did not show where an
employee clocked in or out. The application already captures GPS coordinates,
but it does **not** save a human-readable address at clock-in time.

The implemented solution resolves the saved coordinates when an attendance
report is generated, caches successful results in MongoDB, and falls back to
the raw coordinates whenever the external geocoder is unavailable.

This feature applies only to the ATTENDANCE report. Leave, Overtime, Business
Trip, and Sakit reports are unchanged.

## 2. What the attendance database stores

Source model: `backend/src/infrastructure/models/attendance.model.js`

Each attendance document can contain both objects below:

```text
clockInLocation
clockOutLocation
    latitude
    longitude
    accuracy
    timestamp
    permissionState
    acquisitionStatus
```

Example:

```json
{
  "latitude": -6.208763,
  "longitude": 106.845599,
  "accuracy": 12,
  "timestamp": "2026-08-09T01:30:00.000Z",
  "permissionState": "granted",
  "acquisitionStatus": "found"
}
```

Important:

- `latitude` and `longitude` are the source of truth for this report feature.
- There is no address field in the attendance schema.
- The reverse-geocoded address is not written back into attendance documents.
- Existing historical attendance records require no migration.

## 3. Report behavior

The ATTENDANCE report registry is defined in
`backend/src/domain/report.js`. Its location columns are:

| Column key | Indonesian label | Source |
|---|---|---|
| `clockInLocation` | Lokasi absen masuk | `attendance.clockInLocation` |
| `clockOutLocation` | Lokasi absen keluar | `attendance.clockOutLocation` |

The columns appear in both:

- the on-screen Laporan preview, and
- the server-generated Absensi `.xlsx` export.

Display rules:

1. If a cached or newly resolved address exists, display the readable address.
2. If geocoding fails, times out, is disabled, or has not completed before the
   report deadline, display coordinates with six decimal places, for example:
   `-6.208763, 106.845599`.
3. If that clock event has no valid coordinate pair, display an empty value in
   Excel (and `—` in the preview table).

## 4. End-to-end architecture

```text
MongoDB attendance document
        |
        v
AttendanceReportProvider
  selects employee/date/time + coordinate pair
        |
        v
ReportService.enrichLocations()
        |
        +--> LocationGeocodeRepository.findByKeys()
        |       |
        |       +--> cached address -> use immediately
        |
        +--> Photon reverse-geocoding request for cache misses
                |
                +--> save successful address in location_geocodes
                +--> failure -> coordinate fallback
        |
        v
Report preview / ExcelJS workbook
```

Key implementation files:

| File | Responsibility |
|---|---|
| `backend/src/domain/report.js` | ATTENDANCE column keys and export labels |
| `backend/src/infrastructure/report-providers.js` | Reads attendance rows and passes only valid latitude/longitude pairs |
| `backend/src/infrastructure/geocoding/reverse-geocoder.js` | Photon HTTP client, coordinate normalization, cache lookup orchestration, address formatting, timeout/rate limit/fallback behavior |
| `backend/src/infrastructure/models/location-geocode.model.js` | Mongoose schema for cached addresses |
| `backend/src/infrastructure/repositories/location-geocode.repository.js` | Cache persistence adapter |
| `backend/src/application/report.service.js` | Enriches preview/export rows and applies coordinate fallback |
| `backend/src/infrastructure/exporters/excel.exporter.js` | Renders the location columns with wider Excel widths |
| `backend/server.js` | Wires the cache repository and geocoder into `ReportService` |
| `frontend/src/lib/labels.ts` | Frontend label mirror for the dynamic preview table |

## 5. Reverse-geocoding provider

The default provider is Photon:

```text
https://photon.komoot.io/reverse?lat=<latitude>&lon=<longitude>&limit=1&lang=default
```

Photon is based on OpenStreetMap data and returns address/locality properties
such as street, house number, locality, district, city, state, postcode, and
country. The formatter combines available non-duplicate parts.

### Why BigDataCloud is not used

The BigDataCloud free `reverse-geocode-client` endpoint is intended for
client-side use with the device's current location. Its Fair Use Policy does
not permit this server-side/batch use case with stored historical coordinates.

### Provider limitations

The public Photon server is a community/demo service with fair-use throttling
and no application SLA. The implementation therefore:

- sends a descriptive `User-Agent`,
- performs lookups sequentially,
- spaces requests using `GEOCODING_MIN_INTERVAL_MS`,
- caches successful results, and
- stops new lookups when the report deadline is reached.

For the current small deployment (approximately 300 users), the public Photon
endpoint is intentionally retained. Keep the 1.1-second fair-use interval and
expect a cold report to show coordinate fallbacks while the cache warms. The
service has no availability SLA or privacy agreement; before materially higher
volume, stricter availability requirements, or a privacy policy that forbids
third-party coordinate transfer, set `GEOCODING_PROVIDER_URL` to a controlled
self-hosted Photon-compatible service or replace the geocoder adapter with a
keyed commercial provider. The current response parser expects Photon
GeoJSON.

## 6. Cache behavior

The cache model is:

```text
backend/src/infrastructure/models/location-geocode.model.js
```

Collection: `location_geocodes`

| Field | Meaning |
|---|---|
| `key` | Unique coordinate key rounded to four decimal places (~11 m): `lat,lng` |
| `latitude` / `longitude` | Coordinates used for the lookup |
| `address` | Successfully formatted Photon address |
| `provider` | Currently `photon` |
| `resolvedAt` | Successful lookup time |
| `createdAt` / `updatedAt` | Mongoose timestamps |

Repeated exports of the same location use the cache and make no external
request. Failed lookups are not stored as addresses, so a later report can
retry them. To force a corrected lookup, delete the relevant cache document;
the next report will resolve it again.

The provider queue starts each report deadline when the lookup request is
enqueued. A preview therefore expires its own geocoding work instead of waiting
behind a long export. Unresolved provider calls produce one batch warning in
the backend log without logging employee coordinates; the report still uses
the coordinate fallback.

## 7. Configuration

Defaults are defined in `backend/src/infrastructure/config.js` and can be
overridden through `backend/.env`. Do not commit secrets or provider keys.

| Variable | Default | Purpose |
|---|---|---|
| `GEOCODING_ENABLED` | `true` | Disable all external lookups when `false`; reports still show coordinates |
| `GEOCODING_PROVIDER` | `photon` | Provider label stored in cache |
| `GEOCODING_PROVIDER_URL` | `https://photon.komoot.io` | Photon-compatible provider base URL |
| `GEOCODING_LANGUAGE` | `default` | Photon language hint; the public server supports `default`, `de`, `en`, and `fr` |
| `GEOCODING_TIMEOUT_MS` | `4000` | Maximum time for one HTTP lookup |
| `GEOCODING_MIN_INTERVAL_MS` | `1100` | Delay between uncached provider calls |
| `GEOCODING_PREVIEW_DEADLINE_MS` | `4000` | Resolution budget for one preview request |
| `GEOCODING_EXPORT_DEADLINE_MS` | `20000` | Resolution budget for one Excel export |

The report never fails solely because geocoding or its cache fails.

## 8. Testing and verification

Unit tests:

- `backend/test/unit/reverse-geocoder.test.js`
- `backend/test/unit/report.service.test.js`
- `backend/test/unit/report.domain.test.js`
- `backend/test/unit/report.exporter.test.js`

Integration coverage:

- `backend/test/integration/reports.api.test.js`
- Integration tests disable external geocoding and verify the coordinate
  fallback deterministically.

Run:

```text
cd backend
npm test

cd ../frontend
npm run build
npm run lint
```

Manual check:

1. Open **Laporan** and select **Absensi**.
2. Confirm the preview has `Lokasi absen masuk` and `Lokasi absen keluar`.
3. Confirm rows show an address when Photon/cache resolves it, otherwise
   readable six-decimal coordinates.
4. Export the Absensi Excel file and confirm the same two headers and values.
5. Repeat the export and confirm cached coordinates no longer need a provider
   request.

## 9. Scope and non-goals

- No changes to clock-in/out capture or browser geolocation permissions.
- No address field is added to attendance documents in this implementation.
- No request/approval workflow changes.
- No location columns are added to Leave, Overtime, Trip, or Sakit reports.
- No provider API key is required for the default Photon configuration.
