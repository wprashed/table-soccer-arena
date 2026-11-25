/**
 * Captures every screen (desktop + mobile) into screens/ for visual QA.
 * Also asserts there are no console errors and no horizontal overflow.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
mkdirSync('screens', { recursive: true });

const PAGES = [
  ['01-auth', '/'],
  ['10-dashboard', '/'],
  ['11-quickmatch', '/play/quick'],
  ['12-leaderboard', '/leaderboard'],
  ['13-tournaments', '/tournaments'],
  ['14-friends', '/friends'],
  ['15-store', '/store'],
  ['16-profile', '/player/alexrod'],
  ['17-history', '/history'],
  ['18-practice', '/practice'],
  ['19-settings', '/settings'],
];

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ---- desktop
const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await dctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 140)); });

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.screenshot({ path: 'screens/01-auth.png' });
await p.getByText('Demo player', { exact: true }).click();
await p.waitForTimeout(2000);
for (const [name, path] of PAGES.slice(1)) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `screens/${name}.png`, fullPage: false });
}
// live match
await p.goto(BASE + '/practice', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /Start practice match/ }).click();
await p.waitForTimeout(7000);
await p.screenshot({ path: 'screens/20-match.png' });
// settings: audio tab with the new volume controls
await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'audio', exact: true }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: 'screens/21-settings-audio.png' });
await dctx.close();

// ---- mobile
const mctx = await b.newContext({ ...devices['iPhone 13'] });
const m = await mctx.newPage();
const merrs = [];
let overflow = 0;
m.on('pageerror', (e) => merrs.push('PAGEERROR ' + e.message.slice(0, 140)));
m.on('console', (c) => { if (c.type() === 'error') merrs.push('CONSOLE ' + c.text().slice(0, 140)); });
await m.goto(BASE, { waitUntil: 'networkidle' });
await m.getByText('Demo player', { exact: true }).tap();
await m.waitForTimeout(1800);
for (const [name, path] of PAGES.slice(1)) {
  await m.goto(BASE + path, { waitUntil: 'networkidle' });
  await m.waitForTimeout(800);
  overflow = Math.max(overflow, await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  await m.screenshot({ path: `screens/3${name.slice(1)}-mobile.png` });
}
await m.goto(BASE + '/practice', { waitUntil: 'networkidle' });
await m.getByRole('button', { name: /Start practice match/ }).tap();
await m.waitForTimeout(7000);
overflow = Math.max(overflow, await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
await m.screenshot({ path: 'screens/40-match-mobile.png' });
await mctx.close();
await b.close();

console.log(`screenshots written to screens/`);
console.log(`horizontal overflow: ${overflow}px`);
console.log(`desktop errors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`);
console.log(`mobile errors: ${merrs.length ? merrs.slice(0, 4).join(' | ') : 'none'}`);
