import type { Page } from '@playwright/test';

/**
 * Multi-touch gestures via CDP.
 *
 * Playwright's own touch API is single-point, so pinch needs
 * Input.dispatchTouchEvent directly (Chromium only). Input.synthesizePinchGesture
 * also exists but is flagged experimental and is reported flaky in CI, so it is
 * deliberately avoided here.
 */

interface TouchPoint { x: number; y: number }

export async function pinch(
  page: Page,
  opts: { center: TouchPoint; startRadius: number; endRadius: number; steps?: number },
) {
  const { center, startRadius, endRadius, steps = 10 } = opts;
  const cdp = await page.context().newCDPSession(page);
  const points = (r: number) => ([
    { x: center.x - r, y: center.y },
    { x: center.x + r, y: center.y },
  ]);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(startRadius) });
  for (let i = 1; i <= steps; i++) {
    const r = startRadius + ((endRadius - startRadius) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(r) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function tapAt(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Longer than LONG_PRESS_MS (500) so the recognizer fires. */
export async function longPressAt(page: Page, x: number, y: number, ms = 700) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function swipe(page: Page, from: TouchPoint, to: TouchPoint, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
