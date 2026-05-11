# Load tests

k6 scripts for the two scenarios we care about before going live:

1. **`analyze-burst.js`** — 50 concurrent `POST /api/analyze` requests; measures
   median and p99 latency on the API surface.
2. **`queue-throughput.js`** — 200 jobs queued back-to-back; measures end-to-end
   throughput when run against a 3-worker cluster.

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/get-started/installation/) installed locally
  (`brew install k6` on macOS).
- A reachable API. Local example:

  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.staging up -d --build
  ```

## Run

```bash
# Burst test — defaults to http://localhost:4000
API_URL=http://localhost:4000 k6 run tests/load/analyze-burst.js

# Throughput test — assumes API + worker are up and healthy
API_URL=http://localhost:4000 k6 run tests/load/queue-throughput.js
```

## Targets we hold the system to

| Test                | Metric                | Target            |
|---------------------|-----------------------|-------------------|
| `analyze-burst`     | `http_req_duration` median | < 200 ms     |
| `analyze-burst`     | `http_req_duration` p99    | < 1500 ms    |
| `analyze-burst`     | error rate                 | < 1%         |
| `queue-throughput`  | wall-clock to drain 200    | < 4 min @ 3 workers (~50 jobs/min) |

The `queue-throughput` test only enqueues; the worker is responsible for the
actual processing. Stub stages in the worker complete in tens of ms, so
the headline number you measure today reflects queue plumbing, not real
analyzer cost — re-run once stages call real Playwright + Anthropic.

## Output

k6 prints a summary table at the end. To export JSON for graphing:

```bash
k6 run --out json=results.json tests/load/analyze-burst.js
```
