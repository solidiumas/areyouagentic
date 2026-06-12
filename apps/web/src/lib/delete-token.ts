/**
 * Client-side carrier for a report's one-time delete token.
 *
 * The token is returned once from `POST /api/analyze` (keyed to the job), then
 * promoted to the report id when analysis completes. It lives only in
 * `sessionStorage` on the submitter's device — never sent anywhere except back
 * to our own `DELETE /api/reports/:id`. All access is wrapped so private-mode
 * or disabled storage degrades to "no self-delete button", never a crash.
 */

const jobKey = (jobId: string) => `aya:delete:job:${jobId}`;
const reportKey = (reportId: string) => `aya:delete:report:${reportId}`;

function safeGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable — self-delete simply won't be offered */
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function rememberDeleteTokenForJob(jobId: string, token: string): void {
  safeSet(jobKey(jobId), token);
}

/** Move a job-scoped token to its report once we know the report id. */
export function promoteDeleteToken(jobId: string, reportId: string): void {
  const token = safeGet(jobKey(jobId));
  if (token) {
    safeSet(reportKey(reportId), token);
    safeRemove(jobKey(jobId));
  }
}

export function getDeleteTokenForReport(reportId: string): string | null {
  return safeGet(reportKey(reportId));
}

export function clearDeleteTokenForReport(reportId: string): void {
  safeRemove(reportKey(reportId));
}
