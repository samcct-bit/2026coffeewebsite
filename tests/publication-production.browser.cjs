// Explicit opt-in production check. Secrets stay in memory; only unique test records are changed.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'https://2026coffeewebsite.vercel.app';
const project = 'my-teaching-tools-01';
const authOnly = process.argv.includes('--auth-only');
assert.ok(authOnly || process.argv.includes('--verify-publication'), 'Explicit production mode required');
async function main() {
    const account = JSON.parse(readFileSync('C:/2026_key/my-teaching-tools-01-firebase-adminsdk-fbsvc-6c7a77659b.json', 'utf8'));
    assert.equal(account.project_id, project);
    const { mintFirebaseToken } = await import(pathToFileURL(path.resolve('cloudflare-worker/src/security.js')).href);
    const customToken = await mintFirebaseToken({ FIREBASE_CLIENT_EMAIL: account.client_email, FIREBASE_PRIVATE_KEY: account.private_key });
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    try {
        const page = await browser.newPage();
        await page.goto(origin + '/roast_db.html', { waitUntil: 'domcontentloaded' });
        await page.evaluate(async token => {
            const auth = await import('/js/admin_auth.js');
            await auth.login(token);
            const idToken = await auth.getAdminToken();
            const probe = await fetch('https://gsk-groq-proxy.gansingkim.workers.dev/', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
                body: JSON.stringify({ model: 'security-verification-no-provider-call' })
            });
            const data = await probe.json();
            if (probe.status !== 400 || data.error !== 'Unsupported model') throw new Error('Worker token validation failed');
        }, customToken);
        console.log('PASS actual Firebase custom-token login and Worker ID-token verification (no paid AI call)');
        if (authOnly) return;
        const id = 'publication_check_' + randomUUID().replaceAll('-', '');
        const result = await page.evaluate(async ({ id, project }) => {
            const { publicationStore: store } = await import('/js/publication_store.js');
            const { db } = await import('/js/firebase_config.js');
            const api = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js');
            const base = 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/';
            const checks = [];
            const expect = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
            const anon = (route, options) => fetch(base + route, { ...options, cache: 'no-store' });
            try {
                const draft = await store.save(id, { beanName: '[發布驗證測試，完成即刪除]', roastDate: '2000-01-01',
                    flavorTop: '茉莉、柑橘', flavorMid: '蜂蜜、莓果', flavorBase: '可可、回甘',
                    storyCopy: '專用測試紀錄', supplierCuppingNotes: '不應公開的測試筆記' }, store.newContext(), 'manual');
                expect((await anon('coffee_roasts/' + id)).status === 404, 'draft_not_public');
                expect((await anon('coffee_roast_drafts/' + id)).status === 403, 'anonymous_draft_read_denied');
                const review = { identityConfirmed: true, flavorReviewed: true, evidenceLimitationsAccepted: true, sensoryBasis: 'reference' };
                const published = await store.publish(id, draft._workspace, review);
                const publicData = await (await anon('coffee_roasts/' + id)).json();
                expect(publicData.fields?.flavorTop?.stringValue === '茉莉、柑橘', 'reviewed_publish_public_read');
                expect(!publicData.fields?.supplierCuppingNotes, 'private_fields_excluded');
                expect(publicData.fields?.cuppingScore?.integerValue === '0', 'unconfirmed_cupping_score_hidden');
                const edit = await store.save(id, { ...published, flavorTop: '新草稿' }, published._workspace, 'manual');
                expect((await (await anon('coffee_roasts/' + id)).json()).fields.flavorTop.stringValue === '茉莉、柑橘', 'new_draft_keeps_public_version');
                let rejected = false;
                try { await store.save(id, published, published._workspace, 'manual'); } catch (error) { rejected = /其他分頁/.test(error.message); }
                expect(rejected, 'stale_tab_rejected');
                await store.discard(id, edit._workspace);
                expect((await (await anon('coffee_roasts/' + id)).json()).fields.flavorTop.stringValue === '茉莉、柑橘', 'discard_keeps_public_version');
                expect((await anon('coffee_roasts/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { beanName: { stringValue: '匿名覆寫' } } }) })).status === 403, 'anonymous_write_denied');
                expect((await anon('coffee_roasts/' + id, { method: 'DELETE' })).status === 403, 'anonymous_delete_denied');
            } finally {
                // Only our first-publication test documents; no history was created or real record touched.
                await Promise.all(['coffee_roasts', 'coffee_roast_drafts'].map(collection => api.deleteDoc(api.doc(db, collection, id))));
                expect((await anon('coffee_roasts/' + id)).status === 404, 'test_public_record_removed');
                expect(!(await api.getDoc(api.doc(db, 'coffee_roast_drafts', id))).exists(), 'test_private_record_removed');
            }
            return checks;
        }, { id, project });
        for (const check of result) console.log('PASS production: ' + check);
    } finally { await browser.close(); }
}
main().catch(() => { console.error('FAIL production verification; credentials intentionally omitted. Check the scoped workflow before releasing.'); process.exitCode = 1; });
