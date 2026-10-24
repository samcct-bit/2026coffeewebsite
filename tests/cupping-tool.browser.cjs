const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const auth = `export async function getAdminToken(){return 'fixture-only';} export async function mountAdminUI(callback){document.getElementById('password-overlay').style.display='none';await callback();}`;
const fixture = `import {formProblems,roastFingerprint,roastIdentity,buildSensoryProfile} from '/js/cupping_model.js';
const original={id:'cupping-ui-test',beanName:'杯測介面測試豆',roastDate:'2026-10-17',fcTime:'08:00',dropTime:'09:30',flavorTop:'未揭露的既有風味',flavorMid:'原中調',flavorBase:'原尾韻',_workspace:{version:null,publishedExists:true,publishedRevision:0}};
let record=structuredClone(original),seq=0;window.cuppingFixture={sessions:[],public:structuredClone(original),adopted:null};
export const publicationStore={list:async()=>[structuredClone(record)]};
export const cuppingStore={newId:()=> 'cupping-ui-session-'+(++seq),list:async()=>structuredClone(window.cuppingFixture.sessions),save:async(batch,id,form,version,locking)=>{
const errors=formProblems(form,record.roastDate,locking);if(errors.length)throw Error(errors.join('；'));const old=window.cuppingFixture.sessions.find(s=>s.id===id);if(old?.status==='locked')throw Error('已鎖定');
const result={id,batchId:batch,form:structuredClone(form),status:locking?'locked':'draft',method:'solo',roastColor:'unmeasured',version:'session-version-'+(++seq),roastFingerprint:await roastFingerprint(record),roastSnapshot:roastIdentity(record),referenceSnapshot:{flavorTop:'未揭露的既有風味<img src=x onerror=window.pwned=1>'}};
window.cuppingFixture.sessions=[result,...window.cuppingFixture.sessions.filter(s=>s.id!==id)];return structuredClone(result);},adopt:async(batch,ids,words)=>{
const selected=window.cuppingFixture.sessions.filter(s=>ids.includes(s.id));const profile=await buildSensoryProfile(record,selected,words);record={...record,sensoryProfile:profile,cuppingSessionIds:ids,flavorTop:profile.flavor,flavorMid:profile.mouthfeel,flavorBase:profile.aftertaste,cuppingScore:0,_workspace:{version:'adopted-'+(++seq),publishedExists:true,publishedRevision:0}};window.cuppingFixture.adopted=structuredClone(record);return structuredClone(record);}};`;
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/js/admin_auth.js' || url.pathname === '/js/publication_store.js' || url.pathname === '/js/cupping_store.js' || url.pathname === '/js/ai_engine.js') {
            res.setHeader('Content-Type', 'text/javascript'); return res.end(url.pathname.includes('admin_auth') ? auth : url.pathname.includes('ai_engine') ? 'window.GansingKimAI={verifyPasswordSecure:async()=>false};' : fixture);
        }
        const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!target.startsWith(root + path.sep) || /(?:^|\/)(?:scratch|node_modules|\.git|\.env)/.test(url.pathname)) { res.writeHead(403); return res.end(); }
        res.setHeader('Content-Type', target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await fs.readFile(target));
    } catch { res.writeHead(404); res.end(); }
});
async function fillSession(page, date) {
    for (const [key, value] of Object.entries({ date, greenLot: 'LOT-01', grinder: '磨豆機', grindSetting: '20', waterSource: '同批水' })) await page.locator(`[data-form-field=${key}]`).fill(value);
    await page.locator('#session-form .check input').nth(0).check(); await page.locator('#session-form .check input').nth(1).check();
    await page.locator('details.cup').evaluateAll(nodes => nodes.forEach(node => node.open = true));
    for (let cup = 0; cup < 3; cup++) for (let round = 0; round < 3; round++) for (const [category, text] of Object.entries({ flavor: '柑橘、花香', mouthfeel: '滑順', aftertaste: '紅茶、回甘' })) {
        await page.locator(`[data-cup="${cup}"][data-round="${round}"][data-category=${category}]`).fill(text);
    }
}
async function selectWords(page) {
    for (const text of ['柑橘', '滑順', '紅茶']) await page.getByRole('button', { name: text, exact: true }).click();
    await page.locator('#adoption-confirmed').check();
}
(async () => {
    await new Promise(resolve => server.listen(5503, '127.0.0.1', resolve)); let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
        await page.goto('http://127.0.0.1:5503/cupping.html?id=cupping-ui-test');
        await page.locator('[data-form-field=greenLot]').waitFor();
        assert.match(await page.locator('#roast-context').textContent(), /焙色未量測.*90/);
        assert.equal(await page.locator('#reference-text').textContent(), '');
        await page.locator('#save-session').click(); await page.waitForFunction(() => document.getElementById('cupping-message').textContent.includes('未完成紀錄已儲存'));
        await page.locator('#lock-session').click(); await page.waitForFunction(() => document.getElementById('cupping-message').textContent.includes('請完成'));
        await fillSession(page, '2026-10-20'); await page.locator('#lock-session').click();
        await page.waitForFunction(() => document.getElementById('session-status').textContent.includes('已鎖定'));
        assert.equal(await page.locator('[data-category=flavor]').first().isDisabled(), true);
        await page.locator('#reference-box summary').click();
        assert.match(await page.locator('#reference-text').textContent(), /未揭露的既有風味/);
        assert.equal(await page.locator('#reference-text img').count(), 0); assert.equal(await page.evaluate(() => window.pwned), undefined);
        await page.locator('[data-evidence-id]').first().check(); await selectWords(page); await page.locator('#adopt-profile').click();
        await page.waitForFunction(() => window.cuppingFixture.adopted?.sensoryProfile?.status === 'single');
        assert.equal(await page.evaluate(() => window.cuppingFixture.public.flavorTop), '未揭露的既有風味');
        assert.equal(await page.evaluate(() => window.cuppingFixture.adopted.flavorMid), '滑順');
        await page.locator('#new-session').click();
        assert.equal(await page.locator('[data-category=flavor]').first().inputValue(), '');
        await fillSession(page, '2026-10-22'); await page.locator('#lock-session').click();
        await page.waitForFunction(() => document.querySelectorAll('[data-evidence-id]').length === 2);
        await page.locator('[data-evidence-id]').first().check(); await selectWords(page); await page.locator('#adopt-profile').click();
        await page.waitForFunction(() => window.cuppingFixture.adopted?.sensoryProfile?.status === 'repeated');
        assert.equal(await page.evaluate(() => window.cuppingFixture.adopted.cuppingScore), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: 'scratch/cupping-tool-390.png' });
        assert.deepEqual(errors, []);
        console.log('PASS cupping browser: empty private observations; draft; incomplete lock blocked; three cups/rounds; immutable UI; delayed reference reveal/XSS; single and repeated adoption; public unchanged; no score; mobile; zero page errors.');
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
