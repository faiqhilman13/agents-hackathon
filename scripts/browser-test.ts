import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser } from '@playwright/test';
import { createApp } from '../server/app';

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done, fail) => reservation.once('error', fail).listen(0, '127.0.0.1', done));
  const address = reservation.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done, fail) => reservation.close(error => error ? fail(error) : done()));
  return address.port;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({channel:'chrome', headless:true});
  } catch (chromeError) {
    try {
      return await chromium.launch({headless:true});
    } catch {
      throw new Error(`Could not launch Chrome or Playwright Chromium. Install Chrome or run "npx playwright install chromium". ${chromeError instanceof Error ? chromeError.message : ''}`);
    }
  }
}

async function main() {
  const project = resolve(import.meta.dirname, '..');
  if (!existsSync(resolve(project, 'dist/extension/index.html'))) {
    throw new Error('Build Margin before the browser check: npm run build');
  }

  const dataDir = mkdtempSync(resolve(tmpdir(), 'margin-browser-'));
  const outputDir = resolve(project, 'test-results');
  mkdirSync(outputDir, {recursive:true});
  const port = await availablePort();
  const built = createApp(dataDir, {port, recover:false});
  const server = await new Promise<Server>((done, fail) => {
    const listening = built.app.listen(port, '127.0.0.1', () => done(listening));
    listening.once('error', fail);
  });
  let browser: Browser | undefined;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    // The library intentionally polls for queue updates, so it never reaches networkidle.
    await page.goto(`http://127.0.0.1:${port}`, {waitUntil:'domcontentloaded'});
    await page.getByRole('heading', {name:/Your research,\s*with a little perspective\./}).waitFor();
    await page.getByRole('button', {name:'Explore an example'}).click();
    await page.getByRole('heading', {name:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks'}).waitFor();

    const note = 'Compare retrieval quality with answer faithfulness in the evaluation.';
    await page.getByLabel('Research notes').fill(note);
    await page.getByRole('button', {name:'Save note'}).click();
    await page.getByRole('button', {name:'Saved', exact:true}).waitFor();
    await page.screenshot({path:resolve(outputDir, 'brief.png'), fullPage:true});

    await page.getByRole('button', {name:'Back to library'}).click();
    const search = page.getByLabel('Search research');
    await search.fill('answer faithfulness');
    await page.getByRole('heading', {name:'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks'}).waitFor();
    await page.screenshot({path:resolve(outputDir, 'library.png'), fullPage:true});

    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`);
    const stored = built.store.list();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].notes, note);
    console.log(`Library smoke passed. Screenshots: ${resolve(outputDir, 'library.png')} and ${resolve(outputDir, 'brief.png')}`);
  } finally {
    await browser?.close();
    await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
    built.store.close();
    rmSync(dataDir, {recursive:true, force:true});
  }
}

await main();
