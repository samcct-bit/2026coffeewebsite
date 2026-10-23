const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const qrcode = require('../js/vendor/qrcode-1.4.4.js');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const auth = `export async function getAdminToken(){if(window.fixtureDenied)throw Error('請先登入管理員');return 'fixture-only';}
export async function login(){} export async function mountAdminUI(callback){if(!window.fixtureDenied){document.getElementById('password-overlay').style.display='none';await callback();}}`;
const firestore = `export const collection=(db,name)=>{window.labelReads.push(name);return name;};
export const doc=(db,name,id)=>({name,id});
const snap=record=>({id:record.id,exists:()=>true,data:()=>({...record})});
export async function getDocs(){return {docs:window.labelRecords.map(snap)};}
export async function getDocFromServer(ref){window.freshReads++;if(window.freshDelay)await new Promise(r=>setTimeout(r,window.freshDelay));return window.fixtureMissing?{exists:()=>false}:snap(window.labelRecords.find(r=>r.id===ref.id));}`;
const fixture = { id: 'label_preview_only_20260801', beanName: '哥倫比亞 白岩莊園 爪哇日曬', nameEn: 'Colombia Peñas Blancas Java Natural',
    roastDate: '2026-08-01', process: '日曬', variety: '爪哇 Java', altitude: '1800m', roastLevel: '淺焙',
    flavorTop: '茉莉、藍莓、櫻桃', flavorMid: '葡萄、哈密瓜', flavorBase: '果甜、柔順回甘', publicationRevision: 2,
    publicationReview: { sensoryBasis: 'reference' } };
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (['/js/admin_auth.js', '/js/firebase_config.js', '/firestore-fixture.js'].includes(url.pathname)) {
            res.setHeader('Content-Type', 'text/javascript');
            return res.end(url.pathname.includes('admin_auth') ? auth : url.pathname.includes('firebase_config') ? 'export const db={};' : firestore);
        }
        const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!target.startsWith(root + path.sep) || /(?:^|\/)(?:scratch|node_modules|\.git|\.env)/.test(url.pathname)) { res.writeHead(403); return res.end(); }
        let content = await fs.readFile(target);
        if (url.pathname === '/js/label_tool.js') content = content.toString().replace('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js', '/firestore-fixture.js');
        res.setHeader('Content-Type', target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'image/webp');
        res.end(content);
    } catch { res.writeHead(404); res.end(); }
});
async function approve(page) { await page.locator('#reviewed').check(); await page.locator('#calibrated').check(); }
(async () => {
    await new Promise(resolve => server.listen(5502, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const context = await browser.newContext({ acceptDownloads: true, deviceScaleFactor: 2 });
        await context.addInitScript(record => {
            window.labelRecords = [record]; window.labelReads = []; window.freshReads = 0; window.printCalls = 0;
            window.print = () => { window.dispatchEvent(new Event('beforeprint')); window.printCalls++; window.printPages = document.querySelectorAll('#print-root .label').length; };
        }, fixture);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:5502/label.html?id=' + fixture.id);
        await page.locator('.label-qr path').waitFor();
        await approve(page);
        await page.waitForFunction(() => !document.getElementById('print').disabled);
        assert.deepEqual(await page.evaluate(() => window.labelReads), ['coffee_roasts']);
        assert.match(await page.locator('.label-basis').textContent(), /待杯測/);
        const size = await page.locator('.label').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
        assert.ok(Math.abs(size.width - 80 * 96 / 25.4) < .1); assert.ok(Math.abs(size.height - 50 * 96 / 25.4) < .1);
        await page.locator('.label').screenshot({ path: 'scratch/label-80x50-qr-preview.png', scale: 'device' });
        const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
        const download = await downloadPromise;
        const json = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
        assert.equal(json.batchId, fixture.id); assert.equal(json.publicationRevision, 2);
        assert.equal(json.qrTarget, 'https://2026coffeewebsite.vercel.app/bean.html?id=' + fixture.id);
        assert.deepEqual(json.labelOnlyEdits, []);
        const expectedQr = qrcode(0, 'M'); expectedQr.addData(json.qrTarget, 'Byte'); expectedQr.make();
        let expectedPath = '';
        for (let row = 0; row < expectedQr.getModuleCount(); row++) for (let col = 0; col < expectedQr.getModuleCount(); col++) {
            if (expectedQr.isDark(row, col)) expectedPath += `M${col + 4},${row + 4}h1v1h-1z`;
        }
        assert.equal(await page.locator('.label-qr path').getAttribute('d'), expectedPath);
        assert.equal(await page.locator('.label-qr').getAttribute('viewBox'), `0 0 ${expectedQr.getModuleCount() + 8} ${expectedQr.getModuleCount() + 8}`);
        for (const dpi of [203, 300]) {
            await page.locator('#dpi').selectOption(String(dpi)); await approve(page);
            const pngEvent = page.waitForEvent('download'); await page.locator('#download-png').click();
            const pngDownload = await pngEvent;
            assert.match(pngDownload.suggestedFilename(), new RegExp(`-${dpi}dpi\\.png$`));
            const output = await fs.readFile(await pngDownload.path());
            const width = Math.round(80 / 25.4 * dpi), height = Math.round(50 / 25.4 * dpi);
            assert.equal(output.readUInt32BE(16), width); assert.equal(output.readUInt32BE(20), height);
            let physical;
            for (let offset = 8; offset < output.length;) {
                const length = output.readUInt32BE(offset);
                if (output.toString('ascii', offset + 4, offset + 8) === 'pHYs') physical = output.readUInt32BE(offset + 8);
                offset += length + 12;
            }
            assert.equal(physical, Math.round(dpi / .0254));
            const pixels = await page.evaluate(async ({ base64, dpi, width, height }) => {
                const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
                const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
                const data = ctx.getImageData(0, 0, width, height).data;
                const label = document.querySelector('.label').getBoundingClientRect(), qr = document.querySelector('.label-qr').getBoundingClientRect();
                const code = window.qrcode(0, 'M'); code.addData(document.getElementById('public-link').href, 'Byte'); code.make();
                const modules = code.getModuleCount(), dots = Math.floor(22 / 25.4 * dpi / (modules + 8));
                const x = Math.round((qr.left - label.left) / label.width * width), y = Math.round((qr.top - label.top) / label.height * height);
                const at = (px, py) => [...data.subarray((py * width + px) * 4, (py * width + px) * 4 + 4)];
                let mismatch = 0;
                for (let row = -4; row < modules + 4; row++) for (let col = -4; col < modules + 4; col++) {
                    const expected = row >= 0 && col >= 0 && row < modules && col < modules && code.isDark(row, col) ? 0 : 255;
                    const rgba = at(x + (col + 4) * dots + Math.floor(dots / 2), y + (row + 4) * dots + Math.floor(dots / 2));
                    if (rgba.slice(0, 3).some(v => v !== expected) || rgba[3] !== 255) mismatch++;
                }
                const ink = selector => {
                    const r = document.querySelector(selector).getBoundingClientRect(); let count = 0;
                    const left = Math.max(0, Math.floor((r.left - label.left) / label.width * width));
                    const right = Math.min(width, Math.ceil((r.right - label.left) / label.width * width));
                    const top = Math.max(0, Math.floor((r.top - label.top) / label.height * height));
                    const bottom = Math.min(height, Math.ceil((r.bottom - label.top) / label.height * height));
                    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) if (at(px, py)[0] < 180) count++;
                    return count;
                };
                return { mismatch, corner: at(0, 0), logoInk: ink('.label-logo'), titleInk: ink('.label-title'), notesInk: ink('.label-notes') };
            }, { base64: output.toString('base64'), dpi, width, height });
            assert.equal(pixels.mismatch, 0); assert.deepEqual(pixels.corner, [255, 255, 255, 255]);
            assert.ok(pixels.logoInk > 100 && pixels.titleInk > 100 && pixels.notesInk > 100, 'PNG text/logo must not be blank');
            await pngDownload.saveAs(`scratch/label-export-${dpi}dpi.png`);
        }
        let lateDownloads = 0;
        const countLate = () => lateDownloads++;
        page.on('download', countLate);
        await page.evaluate(() => {
            window.originalToCanvas = window.htmlToImage.toCanvas;
            window.htmlToImage.toCanvas = async (...args) => {
                window.pngStarted = true;
                const canvas = await window.originalToCanvas(...args);
                await new Promise(resolve => setTimeout(resolve, 250)); return canvas;
            };
        });
        await page.locator('#download-png').click(); await page.waitForFunction(() => window.pngStarted);
        await page.locator('#field-title').fill('輸出時修改文字'); await approve(page);
        await page.waitForFunction(() => document.getElementById('validation').textContent.includes('PNG 未下載'));
        assert.equal(lateDownloads, 0); page.off('download', countLate);
        await page.evaluate(() => window.htmlToImage.toCanvas = window.originalToCanvas);
        await page.locator('#reset').click(); await approve(page);
        await page.locator('#quantity').fill('2'); await approve(page); await page.locator('#print').click();
        assert.equal(await page.evaluate(() => window.printCalls), 1); assert.equal(await page.evaluate(() => window.printPages), 2);
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('#print-root').evaluate(node => getComputedStyle(node).display), 'block');
        const pages = await page.locator('#print-root .label').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.equal(pages[0].x, 0); assert.ok(pages.every(item => Math.abs(item.height - 50 * 96 / 25.4) < .1));
        await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await page.locator('#field-flavorTop').fill('一二三四五六、七八九十甲乙'); await approve(page);
        await page.waitForFunction(() => !document.getElementById('print').disabled);
        await page.locator('#field-flavorTop').fill('一二三四五六、七八九十甲乙丙'); await approve(page);
        assert.equal(await page.locator('#print').isDisabled(), true); assert.match(await page.locator('#validation').textContent(), /13/);
        assert.equal(await page.locator('#download-png').isDisabled(), true);
        await page.locator('#reset').click(); await page.locator('#field-english').fill('A'.repeat(160)); await approve(page);
        await page.waitForFunction(() => document.getElementById('validation').textContent.includes('超出版面'));
        assert.equal(await page.locator('#print').isDisabled(), true);
        await page.locator('#reset').click(); await page.locator('#field-title').fill('<img src=x onerror="window.pwned=1">');
        assert.equal(await page.locator('.label-title img').count(), 0); assert.equal(await page.evaluate(() => window.pwned), undefined);
        await page.locator('#reset').click(); await approve(page);
        await page.evaluate(() => window.labelRecords[0].flavorTop = '新公開版本');
        await page.locator('#print').click();
        await page.waitForFunction(() => document.getElementById('validation').textContent.includes('公開批次已更新'));
        assert.equal(await page.evaluate(() => window.printCalls), 1);
        await page.locator('#reload').click(); await page.waitForFunction(() => document.querySelector('.label-flavor')?.textContent === '新公開版本');
        await page.evaluate(() => window.freshDelay = 250); await approve(page); await page.locator('#print').click();
        await page.locator('#field-title').fill('等待時人工修改'); await approve(page); await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => window.printCalls), 1);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: 'scratch/label-tool-mobile.png', fullPage: true });
        await page.evaluate(() => { document.getElementById('password-overlay').style.display = 'flex'; });
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('#print-root').evaluate(node => getComputedStyle(node).display), 'none');
        assert.deepEqual(errors, []);
        const unknown = await context.newPage();
        await unknown.goto('http://127.0.0.1:5502/label.html?id=unpublished-draft');
        await unknown.waitForFunction(() => document.getElementById('source-status').textContent.includes('尚未發布'));
        assert.equal(await unknown.locator('.label').count(), 0); assert.equal(await unknown.locator('#print').isDisabled(), true);
        const denied = await context.newPage(); await denied.addInitScript(() => window.fixtureDenied = true);
        await denied.goto('http://127.0.0.1:5502/label.html?id=' + fixture.id);
        assert.equal(await denied.locator('#print').isDisabled(), true); assert.deepEqual(await denied.evaluate(() => window.labelReads), []);
        await denied.close(); await unknown.close();
        console.log('PASS label browser: published-only source; 203/300 dpi PNG size/density/content/pixel-perfect QR; PNG edit race blocked; JSON; 80x50 print; overflow; XSS; stale publication; mobile; auth guards; zero page errors.');
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
