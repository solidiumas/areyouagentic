'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Loader2 } from 'lucide-react';

import { ApiClientError, postAnalyze } from '@/lib/api';
import { rememberDeleteTokenForJob } from '@/lib/delete-token';
import { urlSchema } from '@areyouagentic/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  url: urlSchema,
});
type FormValues = z.infer<typeof formSchema>;

const EXAMPLES: ReadonlyArray<{ label: string; url: string }> = [
  { label: 'Try a great example', url: 'https://stripe.com' },
  { label: 'Try a struggling site', url: 'https://example.com' },
  { label: 'Try a typical site', url: 'https://en.wikipedia.org/wiki/Web_crawler' },
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'RATE_LIMITED' || err.status === 429) {
      return "You've made a lot of requests in a short time. Try again in a minute.";
    }
    if (err.code === 'URL_NOT_ALLOWED') {
      return err.message || "We can't analyze this URL. Try a public website.";
    }
    if (err.code === 'NETWORK_ERROR') {
      return err.message;
    }
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export function UrlForm() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onSubmit',
    defaultValues: { url: '' },
  });

  const { ref: rhfRef, ...rest } = register('url');

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { jobId, deleteToken } = await postAnalyze({ url: values.url });
      if (deleteToken) rememberDeleteTokenForJob(jobId, deleteToken);
      router.push(`/analyzing/${encodeURIComponent(jobId)}`);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  const fieldErrorId = 'url-error';
  const serverErrorId = 'url-server-error';

  return (
    <div className="w-full">
      <form
        onSubmit={onSubmit}
        noValidate
        aria-describedby={serverError ? serverErrorId : undefined}
        className="flex w-full flex-col gap-3 sm:flex-row"
      >
        <label htmlFor="url" className="sr-only">
          Website URL to analyze
        </label>
        <Input
          id="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://your-website.com"
          aria-invalid={!!errors.url}
          aria-errormessage={errors.url ? fieldErrorId : undefined}
          className="h-12 flex-1 text-base sm:h-14 sm:text-lg"
          {...rest}
          ref={(el) => {
            rhfRef(el);
            inputRef.current = el;
          }}
        />
        <Button
          type="submit"
          size="xl"
          disabled={isSubmitting}
          className="h-12 sm:h-14"
          aria-disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Analyzing…
            </>
          ) : (
            <>
              Analyze <ArrowRight aria-hidden />
            </>
          )}
        </Button>
      </form>

      {/* Inline validation + server errors share an aria-live region so
          screen-readers announce updates without changing focus. */}
      <div className="mt-2 min-h-[1.25rem] text-sm" aria-live="polite">
        {errors.url ? (
          <p id={fieldErrorId} className="text-destructive">
            {errors.url.message}
          </p>
        ) : null}
        {serverError ? (
          <p id={serverErrorId} className="text-destructive">
            {serverError}
          </p>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Example URLs">
        {EXAMPLES.map((ex) => (
          <li key={ex.url}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setValue('url', ex.url, { shouldValidate: false, shouldDirty: true });
                inputRef.current?.focus();
              }}
            >
              {ex.label}
            </Button>
          </li>
        ))}
      </ul>

      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        Analyze only sites you own or have permission to test. Reports are public to anyone with the
        link, so don&rsquo;t submit private or internal URLs or links containing tokens. Public page
        content may be sent to our AI provider (Anthropic) to generate recommendations.{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>
        .
      </p>
    </div>
  );
}
