/** Browser journey: register → dashboard → store purchase → profile → play → result screen. */
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('screens', { recursive: true });

const BASE = 'http://localhost:3000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|vite/i.test(m.text())) errors.push(m.text()); });

const step = (m) => console.log('• ' + m);

// 1. register a brand new account
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Create account' }).click();
const uname = 'tester' + Math.floor(Math.random() * 9999);
await page.locator('input[placeholder="rod_master"]').fill(uname);
await page.locator('input[type="email"]').fill(`${uname}@arena.dev`);
await page.locator('input[type="password"]').fill('testpass123');
await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
await page.waitForTimeout(2200);
if (!page.url().endsWith('/')) throw new Error('registration did not reach dashboard');
step(`registered ${uname} and landed on the dashboard`);

// 2. daily reward claim
const claim = page.getByRole('button', { name: /Claim daily reward/ });
await claim.click();
await page.waitForTimeout(1200);
const claimedText = await page.getByRole('button', { name: /Claimed today/ }).count();
if (!claimedText) throw new Error('daily reward button did not flip to claimed');
step('daily login reward claimed');

// 3. claim a completed challenge if available
const challengeBtn = page.getByRole('button', { name: 'Claim', exact: true }).first();
if (await challengeBtn.count()) { await challengeBtn.click(); await page.waitForTimeout(900); step('challenge reward claimed'); }

// 4. store: buy a table skin
await page.goto(BASE + '/store', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const buy = page.getByRole('button', { name: 'Buy & equip' }).first();
const coinsBefore = await page.locator('text=/🪙 \\d+/').first().innerText();
await buy.click();
await page.waitForTimeout(1400);
const equipped = await page.getByRole('button', { name: /Equipped/ }).count();
if (!equipped) throw new Error('store purchase did not equip');
step(`bought a cosmetic (${coinsBefore} before)`);
await page.screenshot({ path: 'screens/20-store-after-buy.png' });

// 5. settings: rebind a key
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'controls' }).click();
await page.waitForTimeout(400);
await page.locator('button:has-text("A / ←")').first().click();
await page.keyboard.press('KeyG');
await page.waitForTimeout(600);
const rebound = await page.getByRole('button', { name: 'G' }).count();
if (!rebound) throw new Error('key rebinding did not take effect');
step('control rebinding works');
await page.screenshot({ path: 'screens/21-settings-controls.png' });

// 6. play a solo practice match to a goal, then check the result overlay
await page.goto(BASE + '/practice', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Start practice match/ }).click();
await page.waitForTimeout(5500);
step('practice match started');

let resultSeen = false;
const deadline = Date.now() + 330000;
let n = 0;
while (!resultSeen && Date.now() < deadline) {
  n++;
  // swipe the rod line and hammer kicks from every seat
  const keys = n % 4 === 0 ? ['KeyW', 'KeyS'] : n % 4 === 1 ? ['KeyQ', 'KeyE'] : n % 4 === 2 ? ['KeyH', 'KeyK'] : ['KeyU', 'KeyO'];
  const move = n % 2 === 0 ? 'KeyD' : 'KeyA';
  await page.keyboard.down(move);
  for (const k of keys) { await page.keyboard.down(k); await page.waitForTimeout(70); await page.keyboard.up(k); }
  await page.waitForTimeout(60);
  await page.keyboard.up(move);
  const txt = await page.locator('text=/VICTORY|DEFEAT|DRAW/').count();
  if (txt) resultSeen = true;
}
if (!resultSeen) throw new Error('practice match never reached the result screen');
step('result overlay reached');
await page.screenshot({ path: 'screens/22-result.png' });

const hasRating = await page.locator('text=/Rematch|Dashboard/').count();
if (!hasRating) throw new Error('result screen missing actions');
await page.getByRole('link', { name: /Dashboard/ }).click();
await page.waitForTimeout(1500);
if (!page.url().endsWith('/')) throw new Error('could not return to dashboard');
step('returned to dashboard from results');

await page.screenshot({ path: 'screens/23-dashboard-after.png', fullPage: true });
console.log('\nerrors:', errors.length ? errors : 'none');
await browser.close();
console.log('🎉 browser journey passed');
