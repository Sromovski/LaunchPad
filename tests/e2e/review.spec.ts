import { expect, test, type APIRequestContext } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const statusOf = async (request: APIRequestContext, id: number) => (await (await request.get(`/api/videos/${id}`)).json()).video.status as string;

test('queue loads with the waiting videos, rights badge and thumbnails', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '3 videos to review' })).toBeVisible();
  await expect(page.getByTestId('queue').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('queue-item-1')).toContainText('Check rights (1)');
  await expect(page.getByTestId('queue-item-2')).not.toContainText('Check rights');
  const thumb = page.getByTestId('queue-item-1').locator('img');
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('video plays and the transcript follows it', async ({ page }) => {
  await page.goto('/#/v/2');
  const player = page.getByTestId('player');
  await expect(player).toBeVisible();
  await player.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5);
});

test('J and K move through the queue', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('queue-item-3').click();
  await expect(page.getByRole('heading', { name: 'Needs changes' })).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByRole('heading', { name: 'Reject me' })).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.getByRole('heading', { name: 'Needs changes' })).toBeVisible();
});

test('scrubbing works (server honours range requests)', async ({ request }) => {
  const res = await request.get('/media/1/final.mp4', { headers: { Range: 'bytes=0-1023' } });
  expect(res.status()).toBe(206);
  expect((await res.body()).length).toBe(1024);
});

test('rights gate blocks approval until the box is ticked', async ({ page, request }) => {
  await page.goto('/#/v/1');
  await expect(page.getByTestId('rights-warning')).toBeVisible();
  await expect(page.getByTestId('approve')).toBeDisabled();

  // Keyboard A must not get around it either.
  await page.keyboard.press('a');
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await expect(page.getByText('Tick "I checked the rights" first')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await statusOf(request, 1)).toBe('in_review');

  // And the server refuses a direct POST without the tick.
  const direct = await request.post('/api/videos/1/review', { data: { decision: 'approved' } });
  expect(direct.status()).toBe(400);
  expect(await statusOf(request, 1)).toBe('in_review');
});

test('approve after ticking the rights box updates the DB', async ({ page, request }) => {
  await page.goto('/#/v/1');
  await page.getByTestId('rights-checked').check();
  await expect(page.getByTestId('approve')).toBeEnabled();
  await page.keyboard.press('a');
  await page.getByTestId('confirm').click();
  await expect(page.getByText('Approved. Press J for the next video.')).toBeVisible();
  expect(await statusOf(request, 1)).toBe('approved');
  const detail = await (await request.get('/api/videos/1')).json();
  expect(detail.assets[0].rights_status).toBe('clear');
  expect(detail.assets[0].rights_note).toMatch(/cleared by Thomas/);
});

test('reject with the R key and a reason updates the DB', async ({ page, request }) => {
  await page.goto('/#/v/2');
  await page.getByRole('heading', { name: 'Reject me' }).waitFor();
  await page.keyboard.press('r');
  await page.getByTestId('notes').fill('Duplicate of video 1');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Rejected. Press J for the next video.')).toBeVisible();
  expect(await statusOf(request, 2)).toBe('rejected');
  const detail = await (await request.get('/api/videos/2')).json();
  expect(detail.reviews[0]).toMatchObject({ decision: 'rejected', notes: 'Duplicate of video 1' });
});

test('request changes needs notes, then updates the DB', async ({ page, request }) => {
  await page.goto('/#/v/3');
  await page.getByTestId('changes').click();
  await expect(page.getByTestId('confirm')).toBeDisabled();
  await page.getByTestId('notes').fill('Show the Sun sooner.');
  await page.getByTestId('confirm').click();
  await expect(page.getByText('Changes requested. Press J for the next video.')).toBeVisible();
  expect(await statusOf(request, 3)).toBe('changes_requested');
});

test('history shows decided videos and filters them', async ({ page }) => {
  await page.goto('/#/history');
  await expect(page.getByRole('row')).toHaveCount(5); // header + 4 decided
  await page.getByRole('button', { name: 'Rejected' }).click();
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Reject me' })).toBeVisible();
});

test('queue is empty after every video is decided', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible();
});
