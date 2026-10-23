// Opt-in, read-only production verification. Credentials and downloads never leave this process.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.argv.includes('--verify-download'), 'Explicit production download verification required');
const origin = 'https://2026coffeewebsite.vercel.app';
async function main() {
    const account = JSON.parse(readFileSync('C:/2026_key/my-teaching-tools-01-firebase-adminsdk-fbsvc-6c7a77659b.json', 'utf8'));
    assert.equal(account.project_id, 'my-teaching-tools-01');
    const { mintFirebaseToken } = await import(pathToFileURL(path.resolve('cloudflare-worker/src/security.js')).href);
    const customToken = await mintFirebaseToken({ FIREBASE_CLIENT_EMAIL: account.client_email, FIREBASE_PRIVATE_KEY: account.private_key });
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        const errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const request = route.request();
            if (/firestore\.googleapis\.com/.test(request.url()) && /(?:\/Write\/|documents:commit|documents:batchWrite)/.test(request.url())) {
                writes.push('unexpected_firestore_write'); return route.abort();
            }
            return route.continue();
        });
        await page.goto(origin + '/label.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('login-status').textContent === '');
        assert.equal(await page.locator('#download').isDisabled(), true);
        assert.equal(await page.locator('#password-overlay').isVisible(), true);
        await page.evaluate(async token => { await (await import('/js/admin_auth.js')).login(token); }, customToken);
        await page.waitForFunction(() => document.querySelectorAll('#batch-select option').length > 1);
        const ids = await page.locator('#batch-select option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
        let selectedId;
        for (const id of ids) {
            await page.locator('#batch-select').selectOption(id);
            await page.waitForFunction(id => document.getElementById('source-status').textContent.includes(id) && !!document.querySelector('.label'), id);
            await page.locator('#dpi').selectOption('300');
            await page.waitForFunction(() => document.querySelector('.label-logo')?.complete);
            await page.locator('#reviewed').check(); await page.locator('#calibrated').check();
            await page.waitForTimeout(50);
            if (!await page.locator('#download').isDisabled()) { selectedId = id; break; }
        }
        assert.ok(selectedId, 'No published batch passed print layout checks without edits');
        const event = page.waitForEvent('download'); await page.locator('#download').click();
        const download = await event;
        const snapshot = JSON.parse(readFileSync(await download.path(), 'utf8'));
        assert.equal(snapshot.batchId, selectedId);
        assert.equal(snapshot.qrTarget, origin + '/bean.html?id=' + selectedId);
        assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.template, '80x50-qr-sidebar-v1');
        assert.deepEqual(snapshot.labelOnlyEdits, []);
        const { fingerprint } = await import(pathToFileURL(path.resolve('js/label_model.js')).href);
        assert.equal(snapshot.publicSnapshotSha256, await fingerprint(snapshot.publicRecord));
        assert.match(download.suggestedFilename(), /^label-.*-v\d+\.json$/);
        const pngEvent = page.waitForEvent('download'); await page.locator('#download-png').click();
        const pngDownload = await pngEvent, png = readFileSync(await pngDownload.path());
        assert.equal(png.readUInt32BE(16), 945); assert.equal(png.readUInt32BE(20), 591);
        assert.match(pngDownload.suggestedFilename(), /-300dpi\.png$/);
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        console.log('PASS production label: anonymous blocked; actual Firebase admin login; published batch read; unchanged label text; fresh-version check; JSON and 300dpi PNG downloaded; batch/revision/QR/digest verified; zero database writes or page errors.');
    } finally { await browser.close(); }
}
main().catch(() => { console.error('FAIL production label download verification; credentials and source data intentionally omitted.'); process.exitCode = 1; });
