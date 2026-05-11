import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="container max-w-xl py-20 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3 text-muted-foreground">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <Button asChild className="mt-8">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
