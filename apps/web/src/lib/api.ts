import {
  analyzeRequestSchema,
  analyzeResponseSchema,
  apiErrorSchema,
  jobStatusResponseSchema,
  reportResponseSchema,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type ApiError,
  type JobStatusResponse,
  type ReportResponse,
} from '@areyouagentic/shared';
import type { ZodType } from 'zod';

/**
 * Where the browser sends API requests. Same-origin by default — keeps cookies
 * and CORS simple. Override with `NEXT_PUBLIC_API_URL` to point at a separate
 * Fastify deployment.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Thrown for any non-2xx response. `code` is the API's stable error code
 * (e.g. RATE_LIMITED, URL_NOT_ALLOWED) — UI branches on it instead of status.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

type RequestOptions = {
  signal?: AbortSignal;
};

/**
 * Mint a request id so the browser can quote it when reporting issues and so
 * API logs can be correlated with frontend errors. The middleware also sets one
 * for SSR/RSC traffic — this covers client-side fetches.
 */
function mintRequestId(): string {
  return typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function'
    ? (crypto as Crypto).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<TResp>(
  path: string,
  init: RequestInit,
  responseSchema: ZodType<TResp>,
  { signal }: RequestOptions = {},
): Promise<TResp> {
  const requestId = mintRequestId();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        'X-Request-Id': requestId,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  // Body may be empty on 204; we don't currently use that, but be defensive.
  const text = await res.text();
  const json: unknown = text.length > 0 ? safeParseJson(text) : null;

  if (!res.ok) {
    const parsed = parseError(json);
    throw new ApiClientError(
      res.status,
      parsed.error.code,
      parsed.error.message,
      parsed.error.details,
    );
  }

  const result = responseSchema.safeParse(json);
  if (!result.success) {
    throw new ApiClientError(
      res.status,
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
      { issues: result.error.issues },
    );
  }
  return result.data;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseError(json: unknown): ApiError {
  const result = apiErrorSchema.safeParse(json);
  if (result.success) return result.data;
  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  };
}

// ── Endpoints ───────────────────────────────────────────────────────

export async function postAnalyze(
  body: AnalyzeRequest,
  opts: RequestOptions & { turnstileToken?: string } = {},
): Promise<AnalyzeResponse> {
  const { turnstileToken, ...requestOpts } = opts;
  const validated = analyzeRequestSchema.parse(body);
  return request(
    '/api/analyze',
    {
      method: 'POST',
      body: JSON.stringify(validated),
      headers: turnstileToken ? { 'cf-turnstile-response': turnstileToken } : undefined,
    },
    analyzeResponseSchema,
    requestOpts,
  );
}

export async function getJobStatus(
  jobId: string,
  options?: RequestOptions,
): Promise<JobStatusResponse> {
  return request(
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
    jobStatusResponseSchema,
    options,
  );
}

export async function getReport(
  reportId: string,
  options?: RequestOptions,
): Promise<ReportResponse> {
  return request(
    `/api/reports/${encodeURIComponent(reportId)}`,
    { method: 'GET' },
    reportResponseSchema,
    options,
  );
}

/**
 * Delete a report using its one-time delete token. Resolves on 204; throws
 * `ApiClientError` (code DELETE_FORBIDDEN / NOT_FOUND / …) otherwise.
 */
export async function deleteReport(reportId: string, token: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(reportId)}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'X-Request-Id': mintRequestId(),
        'x-delete-token': token,
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the server. Please try again.');
  }

  if (!res.ok) {
    const text = await res.text();
    const json: unknown = text.length > 0 ? safeParseJson(text) : null;
    const parsed = parseError(json);
    throw new ApiClientError(res.status, parsed.error.code, parsed.error.message, parsed.error.details);
  }
}
