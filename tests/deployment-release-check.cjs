const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const cli = 'C:/Users/samcc/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js';
const deployment = process.argv[2];
assert.ok(/^https:\/\/2026coffeewebsite-[a-z0-9]+-sam-vegan\.vercel\.app$/.test(deployment));
function request(route, extra = []) {
    // CLI manages deployment protection internally; no credentials enter this script's output.
    return execFileSync(process.execPath, [cli, 'curl', route, '--deployment', deployment, '--scope', 'sam-vegan', '--', '--silent', '--show-error', ...extra],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
}
// Git checkouts use LF while a Windows CLI upload can retain CRLF; compare source content, not checkout EOLs.
const hash = text => createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
for (const filename of ['index.html', 'bean.html', 'roast_db.html', 'roast_live.html', 'js/admin_auth.js', 'js/ai_engine.js', 'js/safe_dom.js',
    'js/publication_model.js', 'js/publication_panel.js', 'js/publication_service.js', 'js/publication_store.js',
    'label.html', 'css/label.css', 'js/label_model.js', 'js/label_tool.js', 'js/vendor/qrcode-1.4.4.js']) {
    const body = request(`/${filename}`);
    assert.equal(hash(body), hash(readFileSync(filename)), `Deployment content mismatch: ${filename}`);
    console.log(`PASS deployed content: ${filename}`);
}
const headers = request('/index.html', ['--head']);
for (const expected of [/x-content-type-options:\s*nosniff/i, /x-frame-options:\s*DENY/i, /content-security-policy:\s*object-src 'none'/i]) {
    assert.match(headers, expected);
}
console.log('PASS enforced security headers');
for (const route of ['/.env.local', '/firestore.rules', '/delete_docs.js', '/docs/security-rollout-2026-10-17.md', '/package.json']) {
    const result = request(route, ['--output', 'NUL', '--write-out', '%{http_code}']);
    assert.equal(result.trim(), '404', `Private path must not be deployed: ${route}`);
    console.log(`PASS excluded private path: ${route}`);
}
