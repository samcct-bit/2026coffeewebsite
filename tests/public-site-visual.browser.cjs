// Local, fixture-only visual checks. No Firebase requests or production writes.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const fixture = {
    id: 'visual-fixture', beanName: '視覺測試豆款・非商品資料', origin: '測試產區',
    process: '測試處理法', variety: '測試品種', altitude: '未提供', roastLevel: '淺焙',
    roastDate: '2026-10-23', flavorTop: '測試花香', flavorMid: '測試果香', flavorBase: '測試餘韻',
    storyCopy: '僅供版面測試的虛構內容，不是商品風味或杯測結論。\n此文字用於檢查長篇閱讀的行距與留白。',
    brewTemp: '測試參數', brewMethod: '測試方法', brewGuideNote: '非實際沖煮建議',
    publicationRevision: 1, publishedAt: {seconds: 100}, publicationReview: {sensoryBasis: 'cupped'},
    sensoryProfile: {method: 'solo', status: 'repeated', flavor: '測試風味', mouthfeel: '測試口感', aftertaste: '測試餘韻', dates: ['2026-10-20', '2026-10-23']}
};
const fakeFirebase = `const record=${JSON.stringify(fixture)};
export const getFirestore=()=>({}); export const collection=()=>null;
export const doc=(_,collection,id)=>id;
export const getDoc=async id=>({exists:()=>id===record.id,data:()=>record,id});
export const getDocs=async()=>({forEach:fn=>fn({id:record.id,data:()=>record})});`;
const server = http.createServer(async (req, res) => {
    try {
        const requested = new URL(req.url, 'http://local').pathname;
        const target = path.resolve(root, '.' + requested);
        if (!target.startsWith(root + path.sep) || !/\.(html|js|css|webp)$/.test(target) || /(?:^|\/)(?:scratch|node_modules|docs|tests|\.)/.test(requested)) {
            res.writeHead(403); return res.end();
        }
        res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(target)]);
        let contents = await fs.readFile(target);
        // Replace only the local test response's built-in fallback catalogue.
        if (requested === '/index.html') contents = contents.toString().replace(/let coffeeDatabase = \[[\s\S]*?\n        \];/, 'let coffeeDatabase = [];');
        res.end(contents);
    } catch {res.writeHead(404);res.end();}
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({contentType:'text/javascript', body:route.request().url().includes('firebase-app') ? 'export const initializeApp=()=>({});' : fakeFirebase}));
        // Prevent accidental real database/API access while allowing public CSS/fonts.
        await page.route('**/*', async route => {
            const url = route.request().url();
            if (/firestore\.googleapis|identitytoolkit|workers\.dev|generativelanguage|api\.groq/.test(url)) return route.abort();
            return route.fallback();
        });
        for (const width of [390,1280]) {
            await page.setViewportSize({width,height:900});
            for (const file of ['index','bean']) {
                await page.goto(`${base}/${file}.html${file==='bean'?'?id=visual-fixture':''}`, {waitUntil:'networkidle'});
                await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(18, 16, 14)');
                if (file === 'bean') {
                    await page.locator('#bean-detail').waitFor({state:'visible'});
                    assert.equal(await page.locator('#solo-sensory-title').textContent(),'本批單人複測');
                    assert.equal(await page.locator('#solo-mouthfeel').textContent(),'測試口感');
                    assert.equal(await page.locator('#cupping-score-section').isVisible(),false);
                    assert.equal(await page.locator('#legacy-flavor-profile').isVisible(),false);
                } else {
                    await page.locator('a[href*="id=visual-fixture"]').first().waitFor();
                    assert.equal(await page.locator('.bean-card-wrapper').count(),1);
                    assert.equal(await page.locator('#coffee-grid').getByText('口感',{exact:true}).count(),1);
                    assert.equal(await page.locator('#coffee-grid').getByText('測試口感',{exact:true}).count(),1);
                    assert.equal(await page.locator('.customer-cta').getAttribute('href'),'#selection-portal');
                    await page.locator('.admin-tools summary').click();
                    assert.equal(await page.locator('.admin-tools a[href="./label.html"]').isVisible(),true);
                    await page.locator('.admin-tools summary').click();
                }
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `${file} overflow at ${width}`);
                // Screenshots are generated output only; all displayed batch data is fake.
                await page.screenshot({path:`scratch/public-site-${file}-${width}.png`,fullPage:true});
                console.log(`${file} ${width}px: no overflow`);
            }
        }
        await page.goto(`${base}/bean.html?id=unknown-visual-id`,{waitUntil:'networkidle'});
        assert.equal(await page.locator('#publication-empty').isVisible(),true);
        assert.equal(await page.locator('#bean-detail').isVisible(),false);
        // Exercise the real renderer without the new map, then with hostile text.
        await page.route('https://www.gstatic.com/firebasejs/**/firebase-firestore.js', route => route.fulfill({contentType:'text/javascript',body:fakeFirebase.replace(JSON.stringify(fixture),JSON.stringify({...fixture,sensoryProfile:undefined}))}));
        await page.goto(`${base}/bean.html?id=visual-fixture`,{waitUntil:'networkidle'});
        assert.equal(await page.locator('#solo-sensory-profile').isVisible(),false);
        const hostile = {...fixture,sensoryProfile:{...fixture.sensoryProfile,flavor:'<b>測試</b>'}};
        await page.route('https://www.gstatic.com/firebasejs/**/firebase-firestore.js',route=>route.fulfill({contentType:'text/javascript',body:fakeFirebase.replace(JSON.stringify(fixture),JSON.stringify(hostile))}));
        await page.goto(`${base}/bean.html?id=visual-fixture`,{waitUntil:'networkidle'});
        assert.equal(await page.locator('#solo-flavor').textContent(),'<b>測試</b>');
        assert.equal(await page.locator('#solo-flavor b').count(),0);
        assert.deepEqual(errors,[]);
        console.log('Unknown ID, absent sensory map, escaped sensory text, page errors: PASS');
    } finally {
        if(browser) await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
