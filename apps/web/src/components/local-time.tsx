'use client';

import * as React from 'react';

/**
 * Renders a timestamp in the *viewer's* locale and timezone. Server components
 * that call `toLocaleString()` bake the server region's timezone into the HTML
 * (e.g. the hosting region), which is wrong for almost every viewer.
 *
 * The server render (and initial client render) shows the ISO string, then an
 * effect swaps in the browser-localized text after hydration — so server and
 * client markup always match and no hydration mismatch warning fires. The
 * `suppressHydrationWarning` is belt-and-braces for exotic embedders that
 * mutate text nodes before React hydrates.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = React.useState(iso);

  React.useEffect(() => {
    const date = new Date(iso);
    // Keep the ISO fallback if the string is somehow unparsable rather than
    // rendering "Invalid Date".
    if (!Number.isNaN(date.getTime())) setText(date.toLocaleString());
  }, [iso]);

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
