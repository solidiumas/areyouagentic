// k6 queue throughput test — enqueue 200 jobs and watch the worker drain.
//
// Run:  API_URL=http://localhost:4000 k6 run tests/load/queue-throughput.js
//
// The script enqueues N jobs as fast as the API rate limit allows, then
// polls each one until COMPLETED or FAILED. The headline metric is wall
// clock time to drain the batch; throughput = N / wall_clock.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API_URL = __ENV.API_URL || 'http://localhost:4000';
const TOTAL_JOBS = Number(__ENV.JOBS || 200);

const jobDuration = new Trend('job_duration_ms', true);
const jobsCompleted = new Counter('jobs_completed');
const jobsFailed = new Counter('jobs_failed');

// Single VU, single iteration — we coordinate the whole run from here to
// measure wall-clock throughput. k6 will print a stage summary at the end.
export const options = {
  scenarios: {
    drain: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '20m',
    },
  },
  thresholds: {
    // Target: 200 jobs in under 4 minutes with 3 workers (~50/min).
    // Adjust if you scale workers up — the README documents the baseline.
    'iteration_duration{scenario:drain}': ['max<240000'],
    jobs_failed: ['count<5'],
  },
};

function enqueue() {
  const url = `https://example.com/throughput-${randomString(16)}`;
  const res = http.post(`${API_URL}/api/analyze`, JSON.stringify({ url }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'enqueue' },
  });
  if (res.status !== 202 && res.status !== 200) {
    return null;
  }
  try {
    const body = res.json();
    return typeof body.jobId === 'string' ? body.jobId : null;
  } catch {
    return null;
  }
}

function pollJob(jobId, deadlineMs) {
  const start = Date.now();
  // Exponential backoff capped at 2s — keeps the test polite under load.
  let interval = 250;
  while (Date.now() < deadlineMs) {
    const res = http.get(`${API_URL}/api/jobs/${jobId}`, {
      tags: { name: 'poll-job' },
    });
    if (res.status !== 200) {
      sleep(interval / 1000);
      interval = Math.min(2000, interval * 1.5);
      continue;
    }
    try {
      const body = res.json();
      if (body.status === 'COMPLETED' || body.status === 'FAILED') {
        return { status: body.status, durationMs: Date.now() - start };
      }
    } catch {
      // ignore parse error, keep polling
    }
    sleep(interval / 1000);
    interval = Math.min(2000, interval * 1.5);
  }
  return { status: 'TIMEOUT', durationMs: Date.now() - start };
}

export default function () {
  // 1) Enqueue everything. The /api/analyze route limits each IP to 5/min
  // and 20/day — set METRICS_USERNAME/METRICS_PASSWORD in your load env
  // and disable the per-IP cap there, or run multiple k6 instances behind
  // different egress IPs in real load testing.
  const jobIds = [];
  for (let i = 0; i < TOTAL_JOBS; i++) {
    const id = enqueue();
    if (id) {
      jobIds.push(id);
    } else {
      jobsFailed.add(1);
    }
  }
  check(jobIds, {
    'enqueued all jobs': (ids) => ids.length === TOTAL_JOBS,
  });

  // 2) Poll each. The 5-minute per-job deadline matches the worker's hard
  // timeout (90s) with margin for the queue depth in front of it.
  const overallDeadline = Date.now() + 15 * 60 * 1000;
  for (const id of jobIds) {
    const perJobDeadline = Math.min(overallDeadline, Date.now() + 5 * 60 * 1000);
    const result = pollJob(id, perJobDeadline);
    jobDuration.add(result.durationMs);
    if (result.status === 'COMPLETED') {
      jobsCompleted.add(1);
    } else {
      jobsFailed.add(1);
    }
  }

  // Print a final tally — easier to read than digging through k6's summary.
  console.log(
    JSON.stringify({
      total: TOTAL_JOBS,
      enqueued: jobIds.length,
      // jobsCompleted/Failed are k6 counters — we can't read their value
      // here, but the threshold output covers it.
    }),
  );
}
