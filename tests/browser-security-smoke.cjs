// 開發驗證用：啟動限定根目錄的本機靜態伺服器並使用獨立 Edge 設定檔。
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/samcc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
    try {
        const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const target = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
        if (!target.startsWith(root + path.sep) || /(?:^|[\\/])(?:\.[^\\/]+|scratch|node_modules|docs|tests|cloudflare-worker)(?:[\\/]|$)/.test(requested)) {
            res.writeHead(403); return res.end();
        }
        res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
        res.end(await fs.readFile(target));
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(resolve => server.listen(5500, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        for (const route of ['/index.html', '/roast_db.html?id=roast_1785567096800', '/roast_live.html', '/mozart_coffee/batch3.html']) {
            console.log(`Checking ${route}`);
            const errors = [];
            const onError = e => errors.push(e.message);
            page.on('pageerror', onError);
            await page.goto(`http://127.0.0.1:5500${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForFunction(() => typeof window.GansingKimAI?.authenticatedFetch === 'function');
            const status = await Promise.race([page.evaluate(async () => {
                const overlay = document.getElementById('password-overlay');
                const auth = await import('/js/admin_auth.js');
                let anonymousDenied = false;
                try { await auth.getAdminToken(); } catch { anonymousDenied = true; }
                return { anonymousDenied, overlayVisible: !!overlay && getComputedStyle(overlay).display !== 'none', title: document.title,
                    engineReady: typeof window.GansingKimAI?.authenticatedFetch === 'function' };
            }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Firebase module readiness timed out')), 30000); timer.unref(); })]);
            assert.equal(status.anonymousDenied, true, route);
            assert.equal(status.engineReady, true, route);
            if (!route.startsWith('/index')) assert.equal(status.overlayVisible, true, route);
            assert.deepEqual(errors, [], route);
            console.log(JSON.stringify({ route, ...status, pageErrors: errors.length }));
            page.off('pageerror', onError);
        }
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
