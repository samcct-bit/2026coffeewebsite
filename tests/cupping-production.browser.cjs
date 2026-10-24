// Explicit, read-only production check. No real cupping observations are created.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.argv.includes('--verify-readonly'), 'Explicit read-only production mode required');
const origin = 'https://2026coffeewebsite.vercel.app';
let stage = 'setup';
async function main() {
    const account = JSON.parse(readFileSync('C:/2026_key/my-teaching-tools-01-firebase-adminsdk-fbsvc-6c7a77659b.json', 'utf8'));
    assert.equal(account.project_id, 'my-teaching-tools-01');
    const { mintFirebaseToken } = await import(pathToFileURL(path.resolve('cloudflare-worker/src/security.js')).href);
    const customToken = await mintFirebaseToken({ FIREBASE_CLIENT_EMAIL: account.client_email, FIREBASE_PRIVATE_KEY: account.private_key });
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
        const page = await browser.newPage(), errors = [], writes = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', async route => {
            const req = route.request();
            if (/firestore\.googleapis\.com/.test(req.url()) && /(?:\/Write\/|documents:commit|documents:batchWrite)/.test(req.url())) {
                writes.push('unexpected_admin_write'); return route.abort();
            }
            return route.continue();
        });
        const id = 'roast_1785567096800';
        stage = 'anonymous overlay';
        await page.goto(origin + '/cupping.html?id=' + id, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!document.getElementById('password-overlay'));
        assert.equal(await page.locator('#password-overlay').isVisible(), true);
        stage = 'anonymous permission probes';
        const statuses = await page.evaluate(async ({ id, probe }) => {
            const base = 'https://firestore.googleapis.com/v1/projects/my-teaching-tools-01/databases/(default)/documents/';
            const statuses = {};
            for (const [key, route] of Object.entries({ publicRead: 'coffee_roasts/' + id, privateRead: 'coffee_roast_drafts/' + id,
                rawRead: 'coffee_roast_drafts/' + id + '/cupping_sessions/' + probe })) {
                statuses[key] = (await fetch(base + route, { cache: 'no-store' })).status;
            }
            // The nonexistent probe plus exists=true makes this non-mutating even if a rule regresses.
            for (const [key, route] of Object.entries({ publicWrite: 'coffee_roasts/' + probe,
                rawWrite: 'coffee_roast_drafts/' + probe + '/cupping_sessions/' + probe })) {
                statuses[key] = (await fetch(base + route + '?currentDocument.exists=true', { method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { beanName: { stringValue: 'permission-probe' } } }) })).status;
            }
            return statuses;
        }, { id, probe: 'readonly_probe_' + randomUUID().replaceAll('-', '') });
        console.log('Production permission HTTP statuses: ' + JSON.stringify(statuses));
        assert.deepEqual(statuses, { publicRead: 200, privateRead: 403, rawRead: 403, publicWrite: 403, rawWrite: 403 });
        stage = 'admin login and batch load';
        await page.evaluate(async token => { await (await import('/js/admin_auth.js')).login(token); }, customToken);
        await page.waitForFunction(() => document.querySelectorAll('#cupping-batch option').length > 1);
        stage = 'admin private session read';
        await page.evaluate(async id => {
            const { cuppingStore } = await import('/js/cupping_store.js');
            const { publicationStore } = await import('/js/publication_store.js');
            const record = await publicationStore.read(id);
            if (record?.id !== id || !Array.isArray(await cuppingStore.list(id))) throw new Error('Admin private read failed');
        }, id);
        assert.equal(await page.locator('#password-overlay').isVisible(), false);
        await page.setViewportSize({ width: 390, height: 844 });
        for (const route of ['/index.html', '/bean.html?id=' + id]) {
            stage = route.startsWith('/index') ? 'mobile homepage' : 'mobile bean detail';
            await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.fonts.status === 'loaded');
            await page.waitForFunction(() => document.getElementById('coffee-grid')?.children.length > 0 ||
                document.getElementById('btn-view-ror')?.getAttribute('href')?.includes('id='));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        stage = 'page errors and write guard';
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        console.log('PASS production read-only: public read; private/raw anonymous read denied; anonymous writes denied with safe preconditions; real admin login/private session list; mobile public pages; no admin writes or page errors.');
    } finally { await browser.close(); }
}
main().catch(error => { console.error('FAIL production read-only verification at ' + stage + ' (' + error.name + '); credentials intentionally omitted.'); process.exitCode = 1; });
