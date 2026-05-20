// k6 burst test — 50 virtual users hit POST /api/analyze concurrently.
//
// Run:  API_URL=http://localhost:4000 k6 run tests/load/analyze-burst.js
//
// Measures median + p99 latency for the API enqueue path. The worker is
// out of scope for this test — we're only looking at how fast the API
// can validate, dedupe, insert, and return.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API_URL = __ENV.API_URL || 'http://localhost:4000';

// Custom metrics so we can assert on them in `thresholds` below.
const enqueueLatency = new Trend('enqueue_latency_ms', true);
const enqueueErrors = new Rate('enqueue_errors');

// 50 concurrent VUs for 30 seconds. iterations: 'shared' would also work but
// duration gives us a steady-state read on percentile latency.
export const options = {
  scenarios: {
    burst: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // API-side budget — anything slower means we're CPU-bound or the DB is.
    http_req_duration: ['med<200', 'p(99)<1500'],
    enqueue_errors: ['rate<0.01'],
    // 50 VUs * 30s = ~1500 iterations at minimum (one req each).
    http_reqs: ['count>1000'],
  },
};

// Unique-ish hostnames so we don't all hit the 60s in-flight dedupe and end
// up measuring database lookups instead of the full enqueue path. Each VU
// gets its own slug per iteration.
function nextUrl() {
  return `https://example.com/load-${randomString(12)}`;
}

export default function () {
  const url = nextUrl();
  const start = Date.now();

  const res = http.post(`${API_URL}/api/analyze`, JSON.stringify({ url }), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Forwarding a request-id mirrors what the frontend does in prod,
      // so logs from a load run look like real traffic.
      'X-Request-Id': `load-${__VU}-${__ITER}`,
    },
    tags: { name: 'POST /api/analyze' },
  });

  enqueueLatency.add(Date.now() - start);

  const ok = check(res, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'returns a jobId': (r) => {
      try {
        const body = r.json();
        return typeof body.jobId === 'string' && body.jobId.length > 0;
      } catch {
        return false;
      }
    },
  });
  enqueueErrors.add(!ok);

  // A tiny think time — without it 50 VUs hammer the rate limiter and the
  // run is dominated by 429s instead of latency.
  sleep(0.5);
}
