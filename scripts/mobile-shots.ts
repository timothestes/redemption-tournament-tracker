/**
 * Layer 2 validation harness: capture the board across viewports and camera
 * states, then emit a manifest the critique agents cite findings against.
 *
 * Research basis: single-signal UI validation fails (pixel diffs catch movement
 * but miss intent; LLM critique alone trails human experts), so this produces
 * EVIDENCE - screenshot + route + state - rather than a verdict. Layer 1
 * (e2e/mobile/layoutRules.ts) supplies the deterministic half.
 *
 * Usage:  npm run shots:mobile
 *         BASE_URL=http://localhost:3100 npm run shots:mobile
 */

import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { MOBILE_VIEWPORTS, checkTargetSize, checkFontSize } from '../e2e/mobile/layoutRules';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT_DIR = path.resolve(process.cwd(), '.artifacts/mobile-shots');

/** Routes reachable without a live SpacetimeDB game. `intent` travels into the
 *  manifest so a critique agent knows what the screen is supposed to achieve. */
const ROUTES = [
  {
    id: 'play-lobby',
    path: '/play',
    intent: 'Lobby: create or join a game. All controls must be tappable at 44px and readable.',
  },
  {
    id: 'goldfish',
    path: '/goldfish',
    intent: 'Goldfish deck picker. Shares GameCardNode and the virtual canvas with multiplayer, so it is the regression surface for those.',
  },
  {
    // A real rendered BOARD. Goldfish is not the multiplayer canvas, but it
    // shares GameCardNode, the virtual-canvas transform and all eight context
    // menus - so it is the reachable surface for validating card legibility,
    // touch targets and the context-menu sheet without a live SpacetimeDB game.
    id: 'goldfish-board',
    path: `/goldfish/${process.env.SHOTS_DECK_ID ?? '29b5151e-810b-404f-9af5-3af76ca1ee98'}`,
    intent: 'A rendered game board. Cards must be identifiable, zone labels readable, and no element may overflow the canvas. This is the closest reachable proxy for the multiplayer board.',
  },
];

interface Finding {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  selector: string;
}

async function auditPage(page: import('@playwright/test').Page): Promise<Finding[]> {
  const raw = await page.evaluate(() => {
    const out: Array<{ selector: string; w: number; h: number; font: number; tag: string; visible: boolean }> = [];
    const els = document.querySelectorAll('button, a, [role="button"], input, select');
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      const id = el.getAttribute('data-testid') ?? el.id ?? '';
      const label = (el.textContent ?? '').trim().slice(0, 30);
      out.push({
        selector: `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}${label ? `["${label}"]` : ''}`,
        w: r.width, h: r.height,
        font: parseFloat(cs.fontSize) || 0,
        tag: el.tagName.toLowerCase(),
        visible,
      });
    });
    return out;
  });

  const findings: Finding[] = [];
  for (const el of raw) {
    if (!el.visible) continue;
    const t = checkTargetSize({ width: el.w, height: el.h });
    if (!t.ok && t.severity) {
      findings.push({ rule: 'target-size', severity: t.severity, message: t.message, selector: el.selector });
    }
    const f = checkFontSize(el.font);
    if (!f.ok && f.severity) {
      findings.push({ rule: 'font-size', severity: f.severity, message: f.message, selector: el.selector });
    }
  }
  return findings;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const manifest: any[] = [];

  for (const vp of MOBILE_VIEWPORTS) {
    const isTouch = vp.name !== 'desktop-baseline';
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      ...(isTouch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}),
    });
    const page = await context.newPage();

    for (const route of ROUTES) {
      // ?input= forces the input mode, so touch UI can be captured in a
      // desktop Chromium and the desktop baseline stays honest.
      const url = `${BASE_URL}${route.path}?input=${isTouch ? 'touch' : 'pointer'}`;
      const consoleErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      }
      await page.waitForTimeout(1200);

      const file = `${vp.name}__${route.id}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, file) });

      const findings = await auditPage(page);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const gated = await page.evaluate(
        () => !!document.querySelector('[data-testid="rotate-device-prompt"]'),
      );

      manifest.push({
        screenshot: file,
        viewport: vp.name,
        size: `${vp.width}x${vp.height}`,
        route: route.path,
        url,
        inputMode: isTouch ? 'touch' : 'pointer',
        intent: route.intent,
        portraitGated: gated,
        horizontalOverflow: overflow.scrollWidth > overflow.clientWidth,
        findings,
        consoleErrors: consoleErrors.slice(0, 10),
      });

      const errs = findings.filter((f) => f.severity === 'error').length;
      const warns = findings.filter((f) => f.severity === 'warning').length;
      console.log(
        `${file.padEnd(46)} ${String(errs).padStart(3)} err ${String(warns).padStart(3)} warn` +
        `${overflow.scrollWidth > overflow.clientWidth ? '  H-OVERFLOW' : ''}` +
        `${gated ? '  [portrait gated]' : ''}` +
        `${consoleErrors.length ? `  ${consoleErrors.length} console errors` : ''}`,
      );
    }
    await context.close();
  }

  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();

  const totalErr = manifest.reduce((n, m) => n + m.findings.filter((f: Finding) => f.severity === 'error').length, 0);
  console.log(`\n${manifest.length} shots -> ${OUT_DIR}`);
  console.log(`${totalErr} error-level findings. manifest.json written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
