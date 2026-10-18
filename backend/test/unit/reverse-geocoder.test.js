/** Unit tests for the cached Photon reverse geocoder. */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  coordinateKey,
  createReverseGeocoder,
  formatCoordinates,
  formatPhotonAddress,
} = require("../../src/infrastructure/geocoding/reverse-geocoder");

function makeCache(entries = []) {
  const records = new Map(entries.map((entry) => [entry.key, { ...entry }]));
  return {
    reads: [],
    writes: [],
    async findByKeys(keys) {
      this.reads.push([...keys]);
      return keys.map((key) => records.get(key)).filter(Boolean);
    },
    async upsert(entry) {
      this.writes.push({ ...entry });
      records.set(entry.key, { ...entry });
      return entry;
    },
  };
}

const POINT = { latitude: -6.208763, longitude: 106.845599 };
const SILENT_LOGGER = Object.freeze({ warn() {} });

test("coordinate cache keys use four-decimal location buckets", () => {
  assert.equal(coordinateKey(POINT.latitude, POINT.longitude), "-6.2088,106.8456");
});

test("formatCoordinates preserves six decimal places", () => {
  assert.equal(formatCoordinates(POINT), "-6.208763, 106.845599");
  assert.equal(formatCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(formatCoordinates({ latitude: null, longitude: null }), null);
});

test("formatPhotonAddress builds a readable deduplicated address", () => {
  assert.equal(
    formatPhotonAddress({
      street: "Jalan Sudirman",
      housenumber: "1",
      locality: "Setiabudi",
      district: "Setiabudi",
      city: "Jakarta Selatan",
      state: "DKI Jakarta",
      postcode: "12910",
      country: "Indonesia",
    }),
    "Jalan Sudirman 1, Setiabudi, Jakarta Selatan, DKI Jakarta, 12910, Indonesia"
  );
});

test("cache hits avoid Photon requests", async () => {
  const key = coordinateKey(POINT.latitude, POINT.longitude);
  const cache = makeCache([
    { key, address: "Jalan Sudirman 1, Jakarta, Indonesia" },
  ]);
  let requests = 0;
  const geocoder = createReverseGeocoder({
    cacheRepository: cache,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("must not be called");
    },
    config: { enabled: true, minIntervalMs: 0 },
  });

  const result = await geocoder.resolveMany([POINT]);
  assert.equal(result.get(key), "Jalan Sudirman 1, Jakarta, Indonesia");
  assert.equal(requests, 0);
  assert.equal(cache.writes.length, 0);
});

test("cache misses call Photon, format the address, and persist it", async () => {
  const cache = makeCache();
  const urls = [];
  const geocoder = createReverseGeocoder({
    cacheRepository: cache,
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: true,
        async json() {
          return {
            features: [
              {
                properties: {
                  street: "Jalan Sudirman",
                  housenumber: "1",
                  city: "Jakarta",
                  country: "Indonesia",
                },
              },
            ],
          };
        },
      };
    },
    config: { enabled: true, minIntervalMs: 0, timeoutMs: 100 },
  });

  const result = await geocoder.resolveMany([POINT]);
  const key = coordinateKey(POINT.latitude, POINT.longitude);
  assert.equal(result.get(key), "Jalan Sudirman 1, Jakarta, Indonesia");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/reverse\?/);
  assert.match(urls[0], /localityLanguage|lang/);
  assert.equal(cache.writes.length, 1);
  assert.equal(cache.writes[0].key, key);

  const cachedResult = await geocoder.resolveMany([POINT]);
  assert.equal(cachedResult.get(key), "Jalan Sudirman 1, Jakarta, Indonesia");
  assert.equal(urls.length, 1, "the second lookup is served from the cache");
});

test("duplicate coordinates are resolved once and failures return null", async () => {
  let requests = 0;
  const geocoder = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl: async () => {
      requests += 1;
      return { ok: false, async json() { return {}; } };
    },
    logger: SILENT_LOGGER,
    config: { enabled: true, minIntervalMs: 0 },
  });

  const result = await geocoder.resolveMany([
    POINT,
    { latitude: -6.2087631, longitude: 106.8455991 },
  ]);
  const key = coordinateKey(POINT.latitude, POINT.longitude);
  assert.equal(requests, 1);
  assert.equal(result.get(key), null);
});

test("unresolved provider lookups are reported without exposing coordinates", async () => {
  const warnings = [];
  const geocoder = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl: async () => ({ ok: false, async json() { return {}; } }),
    logger: {
      warn(message, metadata) {
        warnings.push({ message, metadata });
      },
    },
    config: { enabled: true, minIntervalMs: 0 },
  });

  await geocoder.resolveMany([POINT]);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "[reverse-geocoder] provider did not resolve locations");
  assert.deepEqual(warnings[0].metadata, {
    provider: "photon",
    attempted: 1,
    unresolved: 1,
  });
  assert.doesNotMatch(JSON.stringify(warnings[0]), /106\.845599/);
});

test("provider timeout/rejected fetch is non-fatal and returns null", async () => {
  const geocoder = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl: async () => {
      throw new Error("simulated timeout");
    },
    logger: SILENT_LOGGER,
    config: { enabled: true, minIntervalMs: 0, timeoutMs: 10 },
  });

  const result = await geocoder.resolveMany([POINT]);
  assert.equal(result.get(coordinateKey(POINT.latitude, POINT.longitude)), null);
});

test("disabled geocoding and expired deadlines never call the provider", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return { ok: true, async json() { return {}; } };
  };
  const disabled = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl,
    config: { enabled: false, minIntervalMs: 0 },
  });
  await disabled.resolveMany([POINT]);

  const expired = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl,
    config: { enabled: true, minIntervalMs: 0 },
  });
  await expired.resolveMany([POINT], { deadlineMs: 0 });

  assert.equal(requests, 0);
});

test("queued lookups honor the deadline measured from enqueue time", async () => {
  let requests = 0;
  let releaseFirst;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => {
    firstStartedResolve = resolve;
  });

  const geocoder = createReverseGeocoder({
    cacheRepository: makeCache(),
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        firstStartedResolve();
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return {
        ok: true,
        async json() {
          return { features: [{ properties: { city: "Jakarta" } }] };
        },
      };
    },
    config: { enabled: true, minIntervalMs: 0, timeoutMs: 100 },
  });

  const first = geocoder.resolveMany([POINT]);
  await firstStarted;

  const queuedPoint = { latitude: -6.3, longitude: 106.9 };
  const queued = geocoder.resolveMany([queuedPoint], { deadlineMs: 0 });
  releaseFirst();

  await first;
  const queuedResult = await queued;

  assert.equal(requests, 1, "the expired queued request must not call Photon");
  assert.equal(queuedResult.get(coordinateKey(queuedPoint.latitude, queuedPoint.longitude)), null);
});
