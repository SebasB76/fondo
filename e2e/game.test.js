import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function phone(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => assert.fail(`${name}: ${e.message}`));
  return page;
}

async function join(page, name) {
  await page.locator('#name-input').fill(name);
  await page.locator('[data-act="join"]').click();
}

const cardNo = (page) => page.locator('.card .card-no').textContent();

async function visible(loc) {
  return (await loc.count()) > 0 && loc.first().isVisible();
}

// Plays whatever each phone is offered until the card resolves.
async function playCard(pages) {
  for (let i = 0; i < 80; i++) {
    for (const p of pages) if (await visible(p.locator('.actions [data-act="next"].btn'))) return;
    for (const p of pages) {
      if (await visible(p.locator('.pad.go'))) { await p.locator('.pad.go').click(); continue; }
      if (await visible(p.locator('[data-act="ready"]'))) { await p.locator('[data-act="ready"]').click(); continue; }
      if (await visible(p.locator('[data-act="reto-pass"]'))) { await p.locator('[data-act="reto-pass"]').click(); continue; }
      if (await visible(p.locator('[data-act="yes"]')) && !(await visible(p.locator('.duo .btn.on')))) {
        await p.locator('[data-act="yes"]').click();
        continue;
      }
      if (await visible(p.locator('.vote-grid [data-act="vote"]')) && !(await visible(p.locator('.vote.on')))) {
        await p.locator('.vote-grid [data-act="vote"]').first().click();
      }
    }
    await sleep(150);
  }
  throw new Error('card never resolved');
}

test('a table of three phones plays a full chupa', { timeout: 180_000 }, async () => {
  const host = await phone('host');
  await host.goto('/');
  await host.locator('[data-act="create"]').click();
  await host.waitForURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().slice(-4);
  await join(host, 'Host');
  await host.locator('.code-big').waitFor();
  assert.equal(await host.locator('.code-big').textContent(), code);
  assert.ok(await host.locator('.qr path').getAttribute('d'));
  assert.ok(await host.locator('[data-act="start"]').isDisabled(), 'cannot start alone');

  const guests = [await phone('g1'), await phone('g2')];
  for (const [i, g] of guests.entries()) {
    await g.goto(`/r/${code}`);
    await join(g, `Pana ${i + 1}`);
    await g.locator('.lobby').waitFor();
  }
  const pages = [host, ...guests];
  await host.locator('.roster .sticker', { hasText: 'Pana 2' }).waitFor();
  assert.equal(await host.locator('.roster .sticker').count(), 3);

  await host.locator('[data-act="level"][data-v="3"]').click();
  await guests[0].locator('.level.on', { hasText: 'Sin frenos' }).waitFor();

  await host.locator('[data-act="start"]').click();
  for (const p of pages) await p.locator('.card').waitFor();

  const kinds = new Set();
  for (let round = 1; round <= 14; round++) {
    const no = `Nº ${String(round).padStart(2, '0')}`;
    for (const p of pages) await p.locator('.card .card-no', { hasText: no }).waitFor({ timeout: 5000 });
    kinds.add(await host.locator('.card').getAttribute('data-kind'));
    await playCard(pages);
    if (round === 5) {
      // A phone that reloads mid-game rejoins without the join screen.
      await guests[1].reload();
      await guests[1].locator('.card').waitFor();
      assert.equal(await cardNo(guests[1]), no);
    }
    await pages[round % 3].locator('.actions [data-act="next"].btn').click();
  }
  assert.ok(kinds.size >= 4, `saw only ${[...kinds].join(', ')}`);

  const drinksOf = async (page) => Number(await page.locator('.board-btn b').textContent());
  const before = await drinksOf(guests[0]);
  await guests[0].locator('.board-btn').click();
  const myRow = guests[0].locator('.board-list li', { hasText: 'Pana 1' });
  await myRow.locator('[data-d="1"]').click();
  await guests[0].locator('.board-btn b', { hasText: String(before + 1) }).waitFor();

  host.once('dialog', (d) => d.accept());
  await host.locator('.board-btn').click();
  await host.locator('[data-act="end"]').click();
  for (const p of pages) await p.locator('.podium .ranking li').first().waitFor();
  assert.equal(await guests[1].locator('.ranking li').count(), 3);
});

test('an unknown table code shows a closed table', async () => {
  const page = await phone('lost');
  await page.goto('/r/ZZZZ');
  await page.locator('text=no existe o ya se acabó').waitFor();
});
