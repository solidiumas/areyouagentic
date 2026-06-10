/**
 * Structured JSON logger for the Next.js app. The Node runtime could use
 * pino, but Next.js code also runs in the Edge runtime (middleware) where
 * pino's worker-thread transport doesn't load. A plain `console.log(JSON)`
 * works in both, and our log pipeline (Vercel / Datadog / Loki) only cares
 * about the JSON shape, not who wrote it.
 *
 * Levels mirror pino's: trace=10, debug=20, info=30, warn=40, error=50, fatal=60.
 */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUE: Record<Level, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const ENV_LEVEL = (process.env.LOG_LEVEL ?? '').toLowerCase() as Level | '';
const MIN_LEVEL: number =
  ENV_LEVEL in LEVEL_VALUE
    ? LEVEL_VALUE[ENV_LEVEL as Level]
    : process.env.NODE_ENV === 'production'
      ? LEVEL_VALUE.info
      : LEVEL_VALUE.debug;

function write(level: Level, payload: Record<string, unknown>, msg?: string): void {
  if (LEVEL_VALUE[level] < MIN_LEVEL) return;
  const entry = {
    level: LEVEL_VALUE[level],
    time: Date.now(),
    app: 'web',
    msg,
    ...payload,
  };
  // Edge and Node both support console.log; the runtime captures stdout/stderr.
  // eslint-disable-next-line no-console -- structured-log shipper, see comment above
  const fn = level === 'error' || level === 'fatal' ? console.error : console.log;
  fn(JSON.stringify(entry));
}

type Bindings = Record<string, unknown>;

export interface Logger {
  debug: (obj: Bindings | string, msg?: string) => void;
  info: (obj: Bindings | string, msg?: string) => void;
  warn: (obj: Bindings | string, msg?: string) => void;
  error: (obj: Bindings | string, msg?: string) => void;
  fatal: (obj: Bindings | string, msg?: string) => void;
  child: (bindings: Bindings) => Logger;
}

function make(base: Bindings): Logger {
  const log = (level: Level) => (obj: Bindings | string, msg?: string) => {
    if (typeof obj === 'string') {
      write(level, base, obj);
    } else {
      write(level, { ...base, ...obj }, msg);
    }
  };
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    fatal: log('fatal'),
    child: (bindings: Bindings) => make({ ...base, ...bindings }),
  };
}

export const logger: Logger = make({});
