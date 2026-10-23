const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const fakeStore = [
    "import {workspaceRecord, preparePayload, buildPublicSnapshot} from '/js/publication_model.js';",
    "const id='publication-ui-test'; let pub={id,beanName:'測試莊園',origin:'哥倫比亞',roastLevel:'淺焙',machine:'盧貝斯1kg全熱風',roastDate:'2026-10-17',flavorTop:'原始花香',flavorMid:'原始蜂蜜',flavorBase:'原始回甘',storyCopy:'原本公開故事',process:'水洗',variety:'Java',rorDatapointsJson:JSON.stringify([{time:'00:00',bt:180,ror:8},{time:'01:00',bt:190,ror:6}]),timelineActionsJson:'[]'}; let draft=null, previous=null, seq=0;",
    "pub.fcTime='08:00';pub.dropTime='09:00';pub.tpTime='01:00';pub.chargeMassG=1000;pub.dropMassG=880;pub.rorDatapointsJson=JSON.stringify([{timeStr:'00:00',timeS:0,beanTemp:180,ror:8,note:''},{timeStr:'08:00',timeS:480,beanTemp:190,ror:6,note:''},{timeStr:'09:00',timeS:540,beanTemp:196,ror:6,note:''}]);",
    "const current=()=>workspaceRecord(id,pub,draft);",
    "window.publicationTest={public:()=>JSON.parse(JSON.stringify(pub)),private:()=>draft,operations:[]};",
    "const check=ctx=>{if(ctx.version!==(draft?.draftVersion||null))throw Error('版本衝突');};",
    "export const publicationStore={newContext:()=>({version:null,publishedExists:false,publishedRevision:0}),list:async()=>[current()],read:async()=>current(),",
    "save:async(id,record,ctx,source)=>{check(ctx);draft={payload:preparePayload(record),publishedPayload:draft?.publishedPayload||preparePayload(pub),status:'draft',draftVersion:'test-version-'+(++seq),basePublishedRevision:pub.publicationRevision||0,source};window.publicationTest.operations.push('save');localStorage.setItem('lastDraftSave',JSON.stringify({payload:draft.payload,publicSnapshot:pub,source}));return current();},",
    "publish:async(id,ctx,review)=>{check(ctx);previous=pub;pub=buildPublicSnapshot(draft.payload,review,{id,publicationRevision:(pub.publicationRevision||0)+1,publishedAt:{seconds:1}});draft={...draft,status:'published',publishedPayload:draft.payload,draftVersion:'test-version-'+(++seq)};window.publicationTest.operations.push('publish');return current();},",
    "discard:async()=>{draft={...draft,status:'published',payload:draft.publishedPayload,draftVersion:'test-version-'+(++seq)};return current();},",
    "restorePrevious:async()=>{draft={...draft,status:'draft',payload:preparePayload(previous),draftVersion:'test-version-'+(++seq)};return current();}};"
].join('\n');
const auth = "export async function getAdminToken(){return 'fixture-only';} export async function mountAdminUI(callback){document.getElementById('password-overlay').style.display='none';if(callback)callback();}";
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/js/publication_store.js' || url.pathname === '/js/admin_auth.js') {
            res.setHeader('Content-Type', 'text/javascript');
            return res.end(url.pathname.includes('publication_store') ? fakeStore : auth);
        }
        const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!target.startsWith(root + path.sep) || url.pathname.includes('..') || /(?:^|\/)(?:scratch|node_modules|\.git|\.env)/.test(url.pathname)) {
            res.writeHead(403); return res.end();
        }
        res.setHeader('Content-Type', target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(await fs.readFile(target));
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(resolve => server.listen(5501, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto('http://127.0.0.1:5501/roast_db.html?id=publication-ui-test', { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: '草稿審核與發布' }).waitFor();
        await page.evaluate(() => {
            window.GansingKimAI.generateRORDiagnosis = async () => ({ suggestion: '測試假設' });
            window.GansingKimAI.calculateRORQualityScore = () => 80;
            window.GansingKimAI.generateCoffeeFlavorAI = async () => ({
                topNote: 'AI柑橘', midNote: '蜂蜜、花香', baseNote: '可可、回甘',
                storyCopy: '<img src=x onerror="window.pwned=1">測試文案',
                generationStatus: 'ai', referenceConflicts: ['來源待核對']
            });
        });
        await page.locator('button[onclick="reanalyzeRecordAndUpdateHome()"]').click();
        await page.waitForFunction(() => window.publicationTest.operations.includes('save'));
        await page.getByText('有待審核草稿。公開網站仍顯示上一個已發布版本。', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.publicationTest.public().flavorTop), '原始花香');
        assert.equal(await page.evaluate(() => window.pwned), undefined);
        assert.equal(await page.locator('#publication-panel img').count(), 0);
        await page.getByRole('button', { name: '編輯草稿', exact: true }).click();
        await page.locator('#edit-flavorTop').fill('人工修訂、可可');
        await page.locator('#edit-modal button[type=submit]').click();
        await page.getByRole('button', { name: '審核並發布', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.publicationTest.public().flavorTop), '原始花香');
        await page.getByRole('button', { name: '審核並發布', exact: true }).click();
        await page.getByRole('status').filter({ hasText: '人工審核' }).waitFor();
        assert.equal(await page.evaluate(() => window.publicationTest.operations.includes('publish')), false);
        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, 'Mobile page overflow: ' + overflow);
        await page.screenshot({ path: 'scratch/publication-review-mobile.png', fullPage: true });
        for (const key of ['identityConfirmed', 'flavorReviewed', 'evidenceLimitationsAccepted']) {
            await page.locator('[data-review-field=' + key + ']').check();
        }
        await page.getByRole('button', { name: '審核並發布', exact: true }).click();
        await page.waitForFunction(() => window.publicationTest.operations.includes('publish'));
        assert.equal(await page.evaluate(() => window.publicationTest.public().flavorTop), '人工修訂、可可');
        await page.getByRole('button', { name: '還原上一版為草稿', exact: true }).click();
        await page.getByText('有待審核草稿。公開網站仍顯示上一個已發布版本。', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.publicationTest.public().flavorTop), '人工修訂、可可');
        await page.getByRole('button', { name: '捨棄草稿', exact: true }).click();
        await page.getByText('目前沒有待發布草稿。編輯或 AI 再分析後，會先另存草稿。', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.publicationTest.public().flavorTop), '人工修訂、可可');
        await page.getByRole('button', { name: '編輯草稿', exact: true }).click();
        await page.evaluate(() => { window.GansingKimAI.generateCoffeeFlavorAI = () => new Promise(resolve => { window.finishTestAI = resolve; }); });
        await page.locator('#edit-ai-btn').click();
        await page.waitForFunction(() => typeof window.finishTestAI === 'function');
        await page.locator('#edit-flavorTop').fill('保留人工內容');
        await page.evaluate(() => window.finishTestAI({ topNote: '過期AI結果', midNote: '蜂蜜', baseNote: '可可' }));
        await page.waitForFunction(() => !document.getElementById('edit-ai-btn').disabled);
        assert.equal(await page.locator('#edit-flavorTop').inputValue(), '保留人工內容');
        await page.evaluate(() => window.closeEditModal());
        await page.goto('http://127.0.0.1:5501/roast_live.html?id=publication-ui-test', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('form-bean').value === '測試莊園');
        await page.locator('#form-flavor-top').fill('即時烘焙草稿');
        await page.locator('#submit-btn').click();
        await page.waitForURL('**/roast_db.html?id=publication-ui-test');
        const liveSave = await page.evaluate(() => JSON.parse(localStorage.getItem('lastDraftSave')));
        assert.equal(liveSave.payload.flavorTop, '即時烘焙草稿');
        assert.equal(liveSave.publicSnapshot.flavorTop, '原始花香');
        assert.equal(liveSave.source, 'roast');
        assert.deepEqual(errors, []);
        console.log('PASS browser: AI draft → manual edit → review gate → publish → restore draft → discard; late AI cannot overwrite edits; live roast saves draft; escaped content; mobile width; zero page errors.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
