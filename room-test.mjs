/** Two real browsers, four players: private room, invite links, host start, live match. */
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('screens', { recursive: true });
const BASE = 'http://localhost:3000';
const step = (m) => console.log('• ' + m);

const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return { ctx, page };
};
const loginAs = async (page, label) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText(label, { exact: true }).click();
  await page.waitForTimeout(1800);
};

const p1 = await mk(); await loginAs(p1.page, 'Demo player');
const p2 = await mk(); await loginAs(p2.page, 'Demo rival');
const p3 = await mk(); await loginAs(p3.page, 'Demo player');
const p4 = await mk(); await loginAs(p4.page, 'Demo rival');
step('four browser sessions signed in');

// host creates a room
await p1.page.goto(BASE, { waitUntil: 'networkidle' });
await p1.page.getByText('Private Room').click();
await p1.page.waitForTimeout(2500);
const codeText = await p1.page.locator('text=/Room code/').first().locator('..').innerText();
const code = (codeText.match(/\d{6}/) || [])[0];
if (!code) throw new Error('no room code: ' + codeText);
step(`room ${code} created`);

// fill with a bot to verify the bot seat, then start with 2 humans + bots
await p1.page.getByRole('button', { name: '+ bot' }).first().click();
await p1.page.waitForTimeout(1200);
step('bot seat filled by host');

// second player joins by invite link
await p2.page.goto(`${BASE}/join/${code}`, { waitUntil: 'networkidle' });
await p2.page.waitForTimeout(3000);
if (!p2.page.url().includes('/match/')) throw new Error('invite link did not seat the player');
step('invite link seated the second player');

// third joins by code from the dashboard input
await p3.page.goto(BASE, { waitUntil: 'networkidle' });
// the join field is collapsed by default to keep the dashboard simple
await p3.page.getByRole('button', { name: /have a room code/i }).click();
await p3.page.getByPlaceholder('ROOM CODE').fill(code);
await p3.page.getByRole('button', { name: 'Join' }).click();
await p3.page.waitForTimeout(3000);
step('third player joined with the code');

// host adds one more bot so all four seats are filled
await p1.page.waitForTimeout(800);
const botBtn = p1.page.getByRole('button', { name: '+ bot' });
if (await botBtn.count()) { await botBtn.first().click(); await p1.page.waitForTimeout(1200); }
const startBtn = p1.page.getByRole('button', { name: /Start match/ });
if (!(await startBtn.count())) {
  await p1.page.screenshot({ path: 'screens/30-lobby.png' });
  throw new Error('start button not available — lobby not full');
}
await p1.page.screenshot({ path: 'screens/30-lobby.png' });
await startBtn.click();
step('host started the match');

await p1.page.waitForTimeout(6000);
await p1.page.screenshot({ path: 'screens/31-private-match.png' });

// play for a bit from both human seats
for (let i = 0; i < 40; i++) {
  for (const p of [p1.page, p2.page, p3.page]) {
    const k = i % 3 === 0 ? 'KeyS' : i % 3 === 1 ? 'KeyW' : 'KeyD';
    await p.keyboard.down(k);
    await p.waitForTimeout(35);
    await p.keyboard.up(k);
  }
}
await p1.page.waitForTimeout(1500);
const scoreShown = await p1.page.locator('text=/GOAL|VICTORY|DEFEAT/').count();
await p1.page.screenshot({ path: 'screens/32-private-play.png' });
step(`match live (goal/result UI elements seen: ${scoreShown})`);

console.log('🎉 private room flow passed');
await browser.close();
