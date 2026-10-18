/**
 * Photon-backed reverse geocoder for report-time attendance location display.
 *
 * The service is deliberately defensive: a report must still render when the
 * external provider is unavailable. Successful lookups are cached by rounded
 * coordinates; unresolved values are represented by the caller as raw coords.
 */

const DEFAULT_PROVIDER_URL = "https://photon.komoot.io";
const DEFAULT_PROVIDER = "photon";
// Photon currently supports `default`, `de`, `en`, and `fr` on its public
// server. `default` preserves the local/administrative name where available.
const DEFAULT_LANGUAGE = "default";
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MIN_INTERVAL_MS = 1100;

function roundCoordinate(value) {
  // GPS readings commonly jitter by several metres. Four decimal places are
  // approximately an 11-metre bucket, which keeps address-level accuracy
  // while making the cache effective for repeated visits to the same place.
  const rounded = Number(Number(value).toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeLocation(location) {
  const rawLatitude = location?.latitude;
  const rawLongitude = location?.longitude;
  if (rawLatitude == null || rawLongitude == null || rawLatitude === "" || rawLongitude === "") {
    return null;
  }

  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return {
    latitude,
    longitude,
    key: coordinateKey(latitude, longitude),
  };
}

function coordinateKey(latitude, longitude) {
  return `${roundCoordinate(latitude).toFixed(4)},${roundCoordinate(longitude).toFixed(4)}`;
}

function formatCoordinates(location) {
  const normalized = normalizeLocation(location);
  if (!normalized) return null;
  return `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`;
}

function uniqueParts(parts) {
  const seen = new Set();
  return parts
    .map((part) => (part == null ? "" : String(part).replace(/\s+/g, " ").trim()))
    .filter((part) => {
      if (!part) return false;
      const identity = part.toLocaleLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

function formatPhotonAddress(properties = {}) {
  const street = uniqueParts([properties.street, properties.housenumber]).join(" ");
  const firstPart = street || properties.name || properties.locality || properties.district;
  const parts = uniqueParts([
    firstPart,
    properties.locality,
    properties.district,
    properties.city,
    properties.state,
    properties.postcode,
    properties.country,
  ]);
  return parts.length > 0 ? parts.join(", ") : null;
}

function photonUrl(providerUrl, location, language) {
  const baseUrl = String(providerUrl || DEFAULT_PROVIDER_URL).replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/reverse`);
  url.searchParams.set("lat", String(location.latitude));
  url.searchParams.set("lon", String(location.longitude));
  url.searchParams.set("limit", "1");
  if (language) url.searchParams.set("lang", String(language));
  return url.toString();
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createReverseGeocoder({
  config = {},
  cacheRepository = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = defaultSleep,
  logger = console,
} = {}) {
  const enabled = config.enabled !== false;
  const provider = config.provider ?? DEFAULT_PROVIDER;
  const providerUrl = config.providerUrl ?? DEFAULT_PROVIDER_URL;
  const language = config.language ?? DEFAULT_LANGUAGE;
  const timeoutMs = positiveNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const minIntervalMs = nonNegativeNumber(config.minIntervalMs, DEFAULT_MIN_INTERVAL_MS);

  let lastRequestAt = null;
  let queue = Promise.resolve();

  async function resolveMany(points = [], { deadlineMs = Infinity } = {}) {
    // Start the deadline when the report asks for geocoding, not after an
    // earlier export or preview has drained the shared provider queue.
    const deadlineAt = createDeadline(now(), deadlineMs);
    const run = queue
      .then(() => resolveManyInternal(points, { deadlineAt }))
      .catch(() => new Map());
    queue = run;
    return run;
  }

  async function resolveManyInternal(points, { deadlineAt }) {
    const normalizedByKey = new Map();
    for (const point of points) {
      const normalized = normalizeLocation(point);
      if (normalized && !normalizedByKey.has(normalized.key)) {
        normalizedByKey.set(normalized.key, normalized);
      }
    }

    const result = new Map();
    if (normalizedByKey.size === 0) return result;

    const keys = [...normalizedByKey.keys()];
    const cached = await readCache(keys);
    const missing = [];
    for (const key of keys) {
      const cachedEntry = cached.get(key);
      if (cachedEntry?.address) {
        result.set(key, cachedEntry.address);
      } else {
        missing.push(normalizedByKey.get(key));
      }
    }

    if (!enabled || typeof fetchImpl !== "function") {
      for (const point of missing) result.set(point.key, null);
      return result;
    }

    let unresolvedLookups = 0;
    for (const point of missing) {
      if (now() >= deadlineAt) {
        result.set(point.key, null);
        continue;
      }

      const ready = await waitForRateLimit(deadlineAt);
      if (!ready) {
        result.set(point.key, null);
        continue;
      }

      const remainingMs = deadlineAt === Infinity ? timeoutMs : Math.max(1, deadlineAt - now());
      const address = await lookup(point, Math.min(timeoutMs, remainingMs));
      if (!address) unresolvedLookups += 1;
      result.set(point.key, address);
      if (address) {
        await writeCache({
          key: point.key,
          latitude: point.latitude,
          longitude: point.longitude,
          address,
          provider,
          resolvedAt: new Date(now()),
        });
      }
    }

    if (unresolvedLookups > 0 && typeof logger?.warn === "function") {
      try {
        logger.warn("[reverse-geocoder] provider did not resolve locations", {
          provider,
          attempted: missing.length,
          unresolved: unresolvedLookups,
        });
      } catch {
        // Logging must never turn a non-fatal geocoding miss into a report error.
      }
    }

    return result;
  }

  async function readCache(keys) {
    if (!cacheRepository?.findByKeys) return new Map();
    try {
      const entries = await cacheRepository.findByKeys(keys);
      return new Map(
        (entries ?? [])
          .filter((entry) => entry?.key)
          .map((entry) => [entry.key, entry])
      );
    } catch {
      // A cache outage must not prevent a report from falling back to coords.
      return new Map();
    }
  }

  async function writeCache(entry) {
    if (!cacheRepository?.upsert) return;
    try {
      await cacheRepository.upsert(entry);
    } catch {
      // The current request already has the resolved address; cache failures
      // only affect the next report and are intentionally non-fatal.
    }
  }

  async function waitForRateLimit(deadlineAt) {
    const current = now();
    const waitMs = lastRequestAt == null
      ? 0
      : Math.max(0, lastRequestAt + minIntervalMs - current);
    if (current + waitMs >= deadlineAt) return false;
    if (waitMs > 0) await sleep(waitMs);
    if (now() >= deadlineAt) return false;
    lastRequestAt = now();
    return true;
  }

  async function lookup(location, requestTimeoutMs = timeoutMs) {
    const url = photonUrl(providerUrl, location, language);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          // Identify the application as requested by public OSM-derived APIs.
          "User-Agent": "AttendanceSystem/1.0 (attendance report geocoding)",
        },
        signal: controller.signal,
      });
      if (!response?.ok) return null;
      const payload = await response.json();
      return formatPhotonAddress(payload?.features?.[0]?.properties);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    resolveMany,
    normalizeLocation,
    coordinateKey,
    formatCoordinates,
    formatPhotonAddress,
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createDeadline(startAt, deadlineMs) {
  const numeric = Number(deadlineMs);
  return Number.isFinite(numeric) ? startAt + Math.max(0, numeric) : Infinity;
}

module.exports = {
  DEFAULT_PROVIDER_URL,
  coordinateKey,
  createReverseGeocoder,
  formatCoordinates,
  formatPhotonAddress,
  normalizeLocation,
};
