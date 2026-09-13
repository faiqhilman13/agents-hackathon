import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';
import type { Capture, Research, ResearchInput } from '../shared/schema';

const FIXTURE_URL = 'https://example.org/margin-fixture';
const FIXTURE_ORIGIN = 'https://example.org/*';
const SECOND_ORIGIN = 'https://example.net/*';
const ARXIV_ORIGIN = 'https://arxiv.org/*';
const API = 'http://127.0.0.1:4317';
const TOKEN = 'extension-integration-test-token';
const COMPLETE_OVERVIEW = 'The isolated Chromium capture was queued in the local harness and completed after the sidebar closed.';

type TargetInfo = { targetId: string; type: string; url: string };
type ChildSession = { root: CDPSession; sessionId: string; sequence: number };
type ApiRequest = { method: string; url: string; headers: Record<string, string>; body?: string };
type ApiReply = { status: number; headers: Record<string, string>; body: string };

function completeResearch(item: Research): Research {
  const source = {
    id: 'S0',
    title: item.input.capture.title,
    url: item.input.capture.url,
    text: item.input.capture.text,
    kind: 'original' as const,
    authors: item.input.capture.authors,
  };
  return {
    ...item,
    status: 'complete',
    stage: 'Saved to your library',
    progress: 100,
    updatedAt: new Date().toISOString(),
    sources: [source],
    mode: 'extractive',
    warnings: ['Synthetic extension integration fixture.'],
    brief: {
      title: item.input.capture.title,
      overview: { text: COMPLETE_OVERVIEW, sourceIds: ['S0'] },
      takeaways: [{ text: 'The captured DOM text reached the durable research job boundary.', sourceIds: ['S0'] }],
      connections: [],
      questions: ['Which detail should be investigated next?'],
      tags: ['integration-test'],
    },
  };
}

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function extensionId(context: BrowserContext): Promise<string> {
  return new URL((await serviceWorker(context)).url()).host;
}

async function waitForPanelTarget(root: CDPSession, extension: string, excluded?: string): Promise<TargetInfo> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const targets = await root.send('Target.getTargets') as { targetInfos: TargetInfo[] };
    const panel = targets.targetInfos.find(target =>
      target.type === 'page' && target.url === `chrome-extension://${extension}/panel.html` && target.targetId !== excluded,
    );
    if (panel) return panel;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chrome did not create the native side-panel target.');
}

async function waitForTargetGone(root: CDPSession, targetId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const targets = await root.send('Target.getTargets') as { targetInfos: TargetInfo[] };
    if (!targets.targetInfos.some(target => target.targetId === targetId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The native side panel did not close.');
}

async function attach(root: CDPSession, targetId: string): Promise<ChildSession> {
  const result = await root.send('Target.attachToTarget', { targetId, flatten: false }) as { sessionId: string };
  return { root, sessionId: result.sessionId, sequence: 1 };
}

async function childCommand<T>(child: ChildSession, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = child.sequence++;
  return new Promise<T>((resolveCommand, rejectCommand) => {
    const timeout = setTimeout(() => {
      child.root.off('Target.receivedMessageFromTarget', receive);
      rejectCommand(new Error(`Timed out waiting for side-panel CDP command ${method}.`));
    }, 8_000);
    const receive = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== child.sessionId) return;
      const message = JSON.parse(event.message) as { id?: number; result?: T; error?: { message: string } };
      if (message.id !== id) return;
      clearTimeout(timeout);
      child.root.off('Target.receivedMessageFromTarget', receive);
      if (message.error) rejectCommand(new Error(message.error.message));
      else resolveCommand(message.result as T);
    };
    child.root.on('Target.receivedMessageFromTarget', receive);
    void child.root.send('Target.sendMessageToTarget', {
      sessionId: child.sessionId,
      message: JSON.stringify({ id, method, params }),
    }).catch(rejectCommand);
  });
}

async function interceptPanelApi(child: ChildSession, respond: (request: ApiRequest) => ApiReply): Promise<() => void> {
  await childCommand(child, 'Fetch.enable', { patterns: [{ urlPattern: `${API}/*`, requestStage: 'Request' }] });
  const receive = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== child.sessionId) return;
    const message = JSON.parse(event.message) as {
      method?: string;
      params?: { requestId: string; request: { method: string; url: string; headers: Record<string, string>; postData?: string } };
    };
    if (message.method !== 'Fetch.requestPaused' || !message.params) return;
    const request = message.params.request;
    const reply = respond({ method: request.method, url: request.url, headers: request.headers, body: request.postData });
    void childCommand(child, 'Fetch.fulfillRequest', {
      requestId: message.params.requestId,
      responseCode: reply.status,
      responseHeaders: Object.entries(reply.headers).map(([name, value]) => ({ name, value })),
      body: Buffer.from(reply.body).toString('base64'),
    });
  };
  child.root.on('Target.receivedMessageFromTarget', receive);
  return () => child.root.off('Target.receivedMessageFromTarget', receive);
}

async function evaluatePanel<T>(child: ChildSession, expression: string, userGesture = false): Promise<T> {
  const response = await childCommand<{ result: { value?: T; description?: string }; exceptionDetails?: unknown }>(child, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  });
  if (response.exceptionDetails) throw new Error(response.result.description || 'Side-panel evaluation failed.');
  return response.result.value as T;
}

async function waitForPanelText(child: ChildSession, text: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    lastBody = await evaluatePanel<string>(child, 'document.body.innerText');
    if (lastBody.includes(text)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Side panel did not render expected text: ${text}\nLast panel text: ${lastBody.slice(0, 1200)}`);
}

async function clickPanel(child: ChildSession, matcher: string): Promise<void> {
  const clicked = await evaluatePanel<boolean>(child, `(() => {
    const button = [...document.querySelectorAll('button')].find(node =>
      node.getAttribute('aria-label') === ${JSON.stringify(matcher)} || node.textContent?.includes(${JSON.stringify(matcher)})
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, true);
  assert(clicked, `Side-panel button not found: ${matcher}`);
}

async function main() {
  const project = resolve(import.meta.dirname, '..');
  const builtExtension = resolve(project, 'dist/extension');
  assert(existsSync(resolve(builtExtension, 'manifest.json')), 'Build Margin before the extension check: npm run build');

  const tempRoot = mkdtempSync(join(tmpdir(), 'margin-extension-'));
  const profile = resolve(tempRoot, 'profile');
  const extension = resolve(tempRoot, 'extension');
  const output = resolve(project, 'test-results');
  mkdirSync(output, { recursive: true });
  cpSync(builtExtension, extension, { recursive: true });

  // The automation harness grants only its synthetic origin up front. This
  // bypasses Chrome's native optional-permission prompt; the shipped manifest
  // still keeps public-site access optional and the UI still calls request().
  const manifestPath = resolve(extension, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { host_permissions: string[] };
  manifest.host_permissions.push(FIXTURE_ORIGIN, SECOND_ORIGIN, ARXIV_ORIGIN);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(extension, 'test-bridge.html'), '<!doctype html><title>Extension test bridge</title><script src="test-bridge.js"></script>');
  writeFileSync(resolve(extension, 'test-bridge.js'), '// Intentionally empty: this extension-origin page sends runtime messages from the harness.\n');

  const jobs = new Map<string, Research>();
  const received: ResearchInput[] = [];
  const apiRequests: string[] = [];
  let jobSequence = 0;
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });

    const fakeApi = (request: ApiRequest): ApiReply => {
      const url = new URL(request.url);
      apiRequests.push(`${request.method} ${url.pathname}`);
      const normalizedHeaders = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const origin = normalizedHeaders.origin || `chrome-extension://${idForCors}`;
      const headers = {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'content-type': 'application/json',
      };
      if (request.method === 'OPTIONS') {
        return { status: 204, headers, body: '' };
      }
      if (url.pathname === '/api/status') {
        return { status: 200, headers, body: JSON.stringify({ ok: true, exa: false, llm: false, model: 'test/no-provider', llmBaseUrl: 'https://invalid.test' }) };
      }
      if (normalizedHeaders.authorization !== `Bearer ${TOKEN}`) {
        return { status: 401, headers, body: JSON.stringify({ error: 'Test token required.' }) };
      }
      if (url.pathname === '/api/research' && request.method === 'GET') {
        return { status: 200, headers, body: JSON.stringify([...jobs.values()]) };
      }
      if (url.pathname === '/api/research' && request.method === 'POST') {
        const input = JSON.parse(request.body || '{}') as ResearchInput;
        received.push(input);
        const now = new Date().toISOString();
        const id = `extension-test-${++jobSequence}`;
        const queued: Research = {
          id,
          requestId: input.requestId,
          status: 'queued',
          stage: 'Waiting to research',
          progress: 0,
          createdAt: now,
          updatedAt: now,
          input,
          sources: [],
          mode: 'extractive',
          warnings: [],
          notes: '',
          favorite: false,
          inLibrary: false,
          collection: input.collection,
        };
        jobs.set(id, queued);
        setTimeout(() => jobs.set(id, completeResearch(queued)), 700);
        return { status: 202, headers, body: JSON.stringify(queued) };
      }
      const researchMatch = url.pathname.match(/^\/api\/research\/([^/]+)$/);
      if (researchMatch && request.method === 'GET') {
        const item = jobs.get(researchMatch[1]);
        return { status: item ? 200 : 404, headers, body: JSON.stringify(item || { error: 'Brief not found.' }) };
      }
      return { status: 404, headers, body: JSON.stringify({ error: `Unhandled test API route: ${request.method} ${url.pathname}` }) };
    };

    // Initialized after the extension id is known; requests always supply an
    // Origin header, but this keeps the fake CORS response deterministic.
    let idForCors = 'test';
    await context.route(`${API}/**`, async route => {
      const request = route.request();
      const reply = fakeApi({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData() || undefined });
      await route.fulfill(reply);
    });

    await context.route('https://example.org/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'content-security-policy': "default-src 'self'; frame-src 'none'" },
      body: `<!doctype html><html><head><title>Margin synthetic fixture</title><meta name="description" content="A deterministic browser fixture for extension verification."></head><body><nav>Navigation should not be captured.</nav><main><article><h1>Research survives the sidebar</h1><p id="evidence">This deterministic fixture contains rendered article text that Readability can extract inside a background Chrome tab. It is deliberately long enough to cross the server's readable-content threshold without relying on any private browsing data or external provider.</p><p>The second paragraph confirms that the extractor reads the rendered document rather than a placeholder supplied by the research API.</p></article></main></body></html>`,
    }));
    await context.route('https://example.net/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Second synthetic tab</title><p>Another harmless public tab used only to verify the tab picker.</p>' }));
    await context.route('https://arxiv.org/pdf/2609.12345', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Synthetic arXiv PDF route</title>' }));

    const worker = await serviceWorker(context);
    const id = await extensionId(context);
    idForCors = id;
    await worker.evaluate(token => chrome.storage.local.set({ connectionToken: token }), TOKEN);
    const bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${id}/test-bridge.html`);

    const fixture = context.pages().find(page => page.url() === 'about:blank') as Page;
    assert(fixture, 'The isolated browser did not create its initial tab.');
    await fixture.goto(FIXTURE_URL);
    const second = await context.newPage();
    await second.goto('https://example.net/other-fixture');
    const arxiv = await context.newPage();
    await arxiv.goto('https://arxiv.org/pdf/2609.12345');

    const ids = await worker.evaluate(async urls => {
      const tabs = await chrome.tabs.query({});
      return Object.fromEntries(urls.map(url => [url, tabs.find(tab => tab.url === url)?.id]));
    }, [FIXTURE_URL, 'https://example.net/other-fixture', 'https://arxiv.org/pdf/2609.12345']);
    const fixtureTabId = ids[FIXTURE_URL];
    const secondTabId = ids['https://example.net/other-fixture'];
    const arxivTabId = ids['https://arxiv.org/pdf/2609.12345'];
    assert(typeof fixtureTabId === 'number');
    assert(typeof secondTabId === 'number');
    assert(typeof arxivTabId === 'number');

    const arxivResponse = await bridge.evaluate(async tabId => chrome.runtime.sendMessage({
      type: 'CAPTURE_AND_RESEARCH', tabId, question: '', collection: 'Reading list', enrich: false,
    }), arxivTabId) as { ok: boolean; research?: Research; error?: unknown };
    assert(arxivResponse.ok, `arXiv no-suffix PDF capture failed: ${JSON.stringify(arxivResponse.error)}`);
    assert.equal(received[0].capture.coverage, 'unavailable');
    assert.equal(received[0].capture.arxivId, '2609.12345');
    assert.equal(received[0].capture.text, '');

    await bridge.evaluate(tabId => chrome.runtime.sendMessage({ type: 'SELECT_TAB', tabId }), fixtureTabId);
    const listed = await bridge.evaluate(() => chrome.runtime.sendMessage({ type: 'LIST_TABS' })) as { ok: boolean; tabs: { id: number; title: string; active: boolean; selected: boolean }[] };
    assert(listed.ok);
    assert(listed.tabs.length >= 3, 'Expected all synthetic tabs from the normal Chrome window.');
    const selectedFixture = listed.tabs.find(tab => tab.id === fixtureTabId);
    assert(selectedFixture?.selected);
    assert.equal(selectedFixture.active, false, 'The chosen fixture must remain a background tab.');

    const permissionGranted = await worker.evaluate(pattern => chrome.permissions.contains({ origins: [pattern] }), FIXTURE_ORIGIN);
    assert(permissionGranted, 'The isolated harness failed to grant its fixture origin.');

    const popupPath = resolve(output, 'popup.png');
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 680 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const openButton = popup.getByRole('button', { name: 'Open assistant' });
    await popup.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Open assistant'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    assert.equal(await popup.locator('#tab-select').inputValue(), String(fixtureTabId));
    const popupOptions = await popup.locator('#tab-select option').allTextContents();
    for (const title of ['Margin synthetic fixture', 'Second synthetic tab', 'Synthetic arXiv PDF route']) {
      assert(popupOptions.includes(title), `Popup tab list is missing ${title}.`);
    }
    await popup.screenshot({ path: popupPath, fullPage: true });
    await openButton.click();

    const overlay = fixture.locator('#__margin_research_overlay__');
    await overlay.waitFor({ state: 'visible' });
    const firstPanel = fixture.frameLocator('#__margin_research_overlay__ iframe');
    await firstPanel.getByText('Margin synthetic fixture').waitFor();
    const welcomeSidebarPath = resolve(output, 'sidebar-welcome.png');
    await overlay.screenshot({ path: welcomeSidebarPath });
    await firstPanel.getByRole('button', { name: /Help me understand/ }).click();

    const deadline = Date.now() + 10_000;
    while (received.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(received.length, 2, 'The sidebar action did not enqueue a captured page.');
    const capture: Capture = received[1].capture;
    assert.equal(capture.url, FIXTURE_URL);
    assert.equal(capture.title, 'Margin synthetic fixture');
    assert.equal(capture.coverage, 'page');
    assert.match(capture.text, /Readability can extract inside a background Chrome tab/);
    assert.doesNotMatch(capture.text, /Navigation should not be captured/);
    assert.equal(received[1].enrich, false, 'The source-only sidebar action must not enable provider enrichment.');

    const fixtureJob = [...jobs.values()].find(job => job.input.capture.url === FIXTURE_URL);
    assert(fixtureJob);
    await firstPanel.getByText('Waiting to research').waitFor();
    await fixture.getByRole('button', { name: 'Close Margin' }).click();
    await overlay.waitFor({ state: 'detached' });

    while (jobs.get(fixtureJob.id)?.status !== 'complete' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(jobs.get(fixtureJob.id)?.status, 'complete', 'The fake server job did not finish after the sidebar closed.');
    const stored = await worker.evaluate(() => chrome.storage.local.get(['selectedTabId', 'latestResearchId', 'researchByTab'])) as {
      selectedTabId?: number;
      latestResearchId?: string;
      researchByTab?: Record<string, string>;
    };
    assert.equal(stored.selectedTabId, fixtureTabId);
    assert.equal(stored.latestResearchId, fixtureJob.id);
    assert.equal(stored.researchByTab?.[String(fixtureTabId)], fixtureJob.id);
    const extensionState = await bridge.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STATE' })) as {
      ok: boolean;
      selectedTabId?: number;
      latestResearchId?: string;
      researchByTab?: Record<string, string>;
    };
    assert(extensionState.ok);
    assert.equal(extensionState.selectedTabId, fixtureTabId);
    assert.equal(extensionState.researchByTab?.[String(fixtureTabId)], fixtureJob.id);

    const reopenPopup = await context.newPage();
    await reopenPopup.goto(`chrome-extension://${id}/popup.html`);
    const reopenButton = reopenPopup.getByRole('button', { name: 'Open assistant' });
    await reopenPopup.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Open assistant'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await reopenButton.click();
    await overlay.waitFor({ state: 'visible' });
    const reopenedPanel = fixture.frameLocator('#__margin_research_overlay__ iframe');
    await reopenedPanel.getByText(COMPLETE_OVERVIEW).waitFor();
    await reopenedPanel.getByText('Add to library').waitFor();
    const sidebarPath = resolve(output, 'sidebar.png');
    await overlay.screenshot({ path: sidebarPath });

    const beforeDrag = await overlay.boundingBox();
    const dragHandle = fixture.locator('#__margin_research_overlay__ .drag');
    const handleBounds = await dragHandle.boundingBox();
    assert(beforeDrag && handleBounds);
    await fixture.mouse.move(handleBounds.x + 70, handleBounds.y + handleBounds.height / 2);
    await fixture.mouse.down();
    await fixture.mouse.move(handleBounds.x - 50, handleBounds.y + 45, { steps: 5 });
    await fixture.mouse.up();
    const afterDrag = await overlay.boundingBox();
    assert(afterDrag && (Math.abs(afterDrag.x - beforeDrag.x) > 50 || Math.abs(afterDrag.y - beforeDrag.y) > 20), 'The floating assistant did not move when dragged.');
    const savedPosition = await worker.evaluate(() => chrome.storage.local.get('overlayPosition')) as { overlayPosition?: { left: number; top: number } };
    assert(savedPosition.overlayPosition, 'The floating assistant position was not persisted.');

    // The embedded assistant's own collapse action is authenticated by the
    // overlay against both its iframe window and extension origin.
    await reopenedPanel.getByRole('button', { name: 'Collapse assistant' }).click();
    await fixture.locator('#__margin_research_overlay__ .shell.collapsed').waitFor();
    const collapsedBounds = await overlay.boundingBox();
    assert(collapsedBounds && collapsedBounds.height <= 40, 'Collapsed overlay still blocks the page below its title bar.');
    await fixture.getByRole('button', { name: 'Expand Margin' }).click();
    await reopenedPanel.getByText(COMPLETE_OVERVIEW).waitFor();
    const expandedBounds = await overlay.boundingBox();
    assert(expandedBounds && expandedBounds.y >= 8 && expandedBounds.y + expandedBounds.height <= 892, 'Expanded overlay is not fully visible in the test viewport.');

    // Moving global selection and opening another overlay must not retarget the
    // already-open fixture conversation.
    await bridge.evaluate(tabId => chrome.runtime.sendMessage({ type: 'SELECT_TAB', tabId }), secondTabId);
    const secondPopup = await context.newPage();
    await secondPopup.goto(`chrome-extension://${id}/popup.html`);
    const secondOpen = secondPopup.getByRole('button', { name: 'Open assistant' });
    await secondPopup.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Open assistant'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    assert.equal(await secondPopup.locator('#tab-select').inputValue(), String(secondTabId));
    await secondOpen.click();
    const secondOverlay = second.locator('#__margin_research_overlay__');
    await secondOverlay.waitFor({ state: 'visible' });
    const secondPanel = second.frameLocator('#__margin_research_overlay__ iframe');
    await secondPanel.getByText('Second synthetic tab').waitFor();
    assert(!await secondPanel.locator('body').innerText().then(text => text.includes(COMPLETE_OVERVIEW)));
    await reopenedPanel.getByText(COMPLETE_OVERVIEW).waitFor();
    await second.getByRole('button', { name: 'Close Margin' }).click();

    await reopenedPanel.getByRole('button', { name: 'New conversation' }).click();
    await reopenedPanel.getByText('FOLLOW YOUR CURIOSITY').waitFor();
    const cleared = await worker.evaluate(() => chrome.storage.local.get(['latestResearchId', 'researchByTab'])) as {
      latestResearchId?: string;
      researchByTab?: Record<string, string>;
    };
    assert.equal(cleared.latestResearchId, undefined);
    assert.equal(cleared.researchByTab?.[String(fixtureTabId)], undefined);
    assert.equal(cleared.researchByTab?.[String(arxivTabId)], 'extension-test-1', 'Clearing one tab must preserve another tab\'s research mapping.');

    // Chrome's PDF viewer cannot host the injected iframe. The same popup
    // gesture must therefore open the manifest-declared native side panel.
    await bridge.evaluate(tabId => chrome.runtime.sendMessage({ type: 'SELECT_TAB', tabId }), arxivTabId);
    const pdfPopup = await context.newPage();
    await pdfPopup.goto(`chrome-extension://${id}/popup.html`);
    const pdfOpen = pdfPopup.getByRole('button', { name: 'Open assistant' });
    await pdfPopup.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('Open assistant'));
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    assert.equal(await pdfPopup.locator('#tab-select').inputValue(), String(arxivTabId));
    const root = await context.browser()!.newBrowserCDPSession();
    await pdfOpen.click();
    const pdfPanelTarget = await waitForPanelTarget(root, id);
    const pdfPanel = await attach(root, pdfPanelTarget.targetId);
    await childCommand(pdfPanel, 'Runtime.enable');
    const stopPdfApi = await interceptPanelApi(pdfPanel, fakeApi);
    await childCommand(pdfPanel, 'Page.reload');
    await waitForPanelText(pdfPanel, 'Synthetic arXiv PDF route');
    await clickPanel(pdfPanel, 'Collapse assistant');
    await waitForTargetGone(root, pdfPanelTarget.targetId);
    stopPdfApi();

    assert(existsSync(popupPath) && existsSync(welcomeSidebarPath) && existsSync(sidebarPath));
    assert(apiRequests.some(request => request === 'POST /api/research'));
    console.log('Chromium floating-extension integration passed.');
    console.log(`Popup screenshot: ${popupPath}`);
    console.log(`Welcome sidebar screenshot: ${welcomeSidebarPath}`);
    console.log(`Sidebar screenshot: ${sidebarPath}`);
    console.log('Optional permission prompt: bypassed with synthetic-origin harness grants.');
    console.log('Provider/network safety: all localhost API calls were intercepted; enrichment was disabled; no user library or provider was contacted.');
  } finally {
    await context?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
