import { expect, test } from '@playwright/test';

const FAKE_JOB_ID = 'job_e2e_123';
const TARGET_URL = 'https://example.com';

test('user enters a URL and is redirected to the analyzing page', async ({ page }) => {
  // Stub the API. The web app calls same-origin by default in dev, so we
  // intercept fetches to /api/* before any are made.
  await page.route('**/api/analyze', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as { url: string };
    expect(body.url).toBe(TARGET_URL);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: FAKE_JOB_ID }),
    });
  });

  // Keep the analyzing page from racing to /report/* before the assertions
  // below run by parking the job in PENDING.
  await page.route(`**/api/jobs/${FAKE_JOB_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: FAKE_JOB_ID, status: 'PENDING' }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /are you agentic/i })).toBeVisible();

  const urlInput = page.getByLabel(/website url to analyze/i);
  await urlInput.fill(TARGET_URL);

  await page.getByRole('button', { name: /^analyze/i }).click();

  await page.waitForURL(`**/analyzing/${FAKE_JOB_ID}`);
  await expect(page).toHaveURL(new RegExp(`/analyzing/${FAKE_JOB_ID}$`));

  await expect(page.getByRole('heading', { level: 1, name: /analyzing your site/i })).toBeVisible();
  await expect(page.getByText(/fetching robots\.txt/i)).toBeVisible();
});
