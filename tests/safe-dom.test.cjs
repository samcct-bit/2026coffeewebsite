const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ctx = vm.createContext({ URL });
vm.runInContext(read('js/safe_dom.js'), ctx);
const { SafeDOM } = ctx;
const attack = `'");globalThis.pwned=1;//<img src=x onerror=alert(1)>&`;
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);

// Minimal DOM double: records HTML sinks and dispatches real registered callbacks.
// This suite deliberately does not load Firebase, CDN scripts or a network browser.
class Element {
    constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.nodes = {}; this.classList = { add() {}, remove() {} }; }
    set innerHTML(html) { this.html = html; this.children = []; }
    get innerHTML() { return this.html || ''; }
    appendChild(child) { this.children.push(child); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    querySelector(selector) { return this.nodes[selector] ||= new Element(); }
    querySelectorAll() {
        return [...this.innerHTML.matchAll(/<button data-record-action="([^"]+)" data-record-id="([^"]*)"/g)].map(([, action, id]) => {
            const button = new Element();
            button.dataset = { recordAction: action, recordId: decode(id) };
            (this.buttons ||= []).push(button);
            return button;
        });
    }
}
function run(file, name, end, globals) {
    const source = read(file);
    const start = source.indexOf(`        function ${name}(`);
    assert.ok(start >= 0);
    const stop = source.indexOf(end, start);
    assert.ok(stop > start);
    const elements = {};
    const sandbox = vm.createContext({ SafeDOM, URL, encodeURIComponent,
        document: { getElementById: id => elements[id] ||= new Element(), createElement: () => new Element(), querySelectorAll: () => [] },
        ...globals });
    vm.runInContext(source.slice(start, stop), sandbox);
    return { sandbox, elements, call: (...args) => sandbox[name](...args) };
}
test('escape HTML preserves data and prevents markup/attribute breakout', () => {
    assert.equal(SafeDOM.escapeHTML(null), '');
    assert.equal(SafeDOM.escapeHTML(0), '0');
    assert.equal(decode(SafeDOM.escapeHTML(attack)), attack);
    assert.doesNotMatch(SafeDOM.escapeHTML(attack), /[<>"']/);
});
test('URLs reject executable schemes, control obfuscation and credentials', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<svg>', 'vbscript:msgbox(1)', 'file:///C:/x', '//example.com', 'https://user:pass@example.com', '', null, ' https://example.com']) {
        assert.equal(SafeDOM.safeURL(url), '', String(url));
    }
    assert.equal(SafeDOM.safeURL('https://example.com/a?q=1&b=2'), 'https://example.com/a?q=1&b=2');
    assert.equal(SafeDOM.safeURL('http://example.com'), 'http://example.com/');
    assert.equal(SafeDOM.safeURL('./bean.html?id=a%26b', 'https://coffee.test/index.html'), 'https://coffee.test/bean.html?id=a%26b');
    assert.equal(SafeDOM.safeURL('javascript:alert(1)', 'https://coffee.test/'), '');
});
test('homepage renders all untrusted fields as text and blocks unsafe links', () => {
    for (const url of ['javascript:alert(1)', './bean.html?id=coffee']) {
        const bean = Object.fromEntries(['origin', 'roast', 'name', 'englishName', 'process', 'altitude', 'variety'].map(key => [key, attack]));
        Object.assign(bean, { flavors: [attack, attack, attack], url });
        const harness = run('index.html', 'renderGrid', '        function setFilter', {
            coffeeDatabase: [bean], filters: { origin: 'all', roast: 'all' }, updateDynamicCounts() {}, window: { location: { href: 'https://coffee.test/index.html' } }
        });
        harness.call();
        const html = harness.elements['coffee-grid'].children[0].innerHTML;
        assert.doesNotMatch(html, /<img|href="javascript:/);
        assert.equal(html.split(SafeDOM.escapeHTML(attack)).length - 1, 10);
        assert.ok(html.includes(url.startsWith('.') ? 'https://coffee.test/bean.html?id=coffee' : 'href="#"'));
    }
});
test('six record actions pass hostile IDs literally via dataset and stop bubbling', () => {
    const calls = [];
    const actions = ['openBeanPage', 'copyBeanToLive', 'openLiveControl', 'reanalyzeRecordAndUpdateHome', 'openEditModal', 'deleteRecordById'];
    const rec = Object.fromEntries(['id', 'origin', 'roastLevel', 'roastDate', 'beanName', 'machine', 'dtrRatio'].map(key => [key, attack]));
    const harness = run('roast_db.html', 'renderRecordsList', '        // 4.', {
        roastingDatabase: [rec], selectedRecord: null, showRecordDetail: id => calls.push(['detail', id]),
        ...Object.fromEntries(actions.map(action => [action, id => calls.push([action, id])]))
    });
    harness.call();
    const card = harness.elements['records-list'].children[0];
    assert.doesNotMatch(card.innerHTML, /onclick=|<img/);
    assert.equal(card.buttons.length, 6);
    for (const button of card.buttons) {
        let stopped = false;
        button.listeners.click({ stopPropagation() { stopped = true; } });
        assert.ok(stopped);
    }
    assert.deepEqual(calls, actions.map(action => [action, attack]));
    card.listeners.click();
    assert.deepEqual(calls.at(-1), ['detail', attack]);
    assert.equal(harness.sandbox.pwned, undefined);
});
test('timeline escapes every imported action field', () => {
    const act = Object.fromEntries(['time', 'temp', 'burner', 'damper', 'note'].map(key => [key, attack]));
    const harness = run('roast_db.html', 'showRecordDetail', '        // 5.', {
        roastingDatabase: [{ id: 'test', timelineActions: [act] }], selectedRecord: null, renderRecordsList() {}, drawRORChart() {}
    });
    harness.call('test');
    const html = harness.elements['detail-timeline'].children[0].innerHTML;
    assert.doesNotMatch(html, /<img/);
    assert.equal(html.split(SafeDOM.escapeHTML(attack)).length - 1, 5);
});
test('grid values never enter HTML and deletion remains wired', () => {
    let removed;
    const harness = run('roast_live.html', 'addGridRow', '        function deleteGridRow', { recalculateGrid() {}, deleteGridRow: button => { removed = button; } });
    harness.call(attack, '180.5', attack);
    const row = harness.elements['ror-grid-body'].children[0];
    assert.doesNotMatch(row.innerHTML, /onerror|onclick|<img/);
    assert.equal(row.querySelector('.grid-time').value, attack);
    assert.equal(row.querySelector('.grid-temp').value, '180.5');
    assert.equal(row.querySelector('.grid-note').value, attack);
    const button = row.querySelector('[data-delete-grid-row]');
    button.listeners.click();
    assert.equal(removed, button);
});
test('source links validate before assignment; data-bearing toast uses textContent', () => {
    for (const file of ['roast_live.html', 'roast_db.html']) {
        const source = read(file);
        assert.match(source, /const sourceURL = SafeDOM.safeURL\(source\?\.url\);\s+if \(!sourceURL\) return;\s+link.href = sourceURL;/);
        assert.match(source, /link.rel = 'noopener noreferrer'/);
        assert.ok(source.indexOf('src="./js/safe_dom.js"') < source.indexOf('<script type="module">'));
    }
    assert.match(read('roast_live.html'), /toast.textContent =/);
    assert.doesNotMatch(read('roast_db.html'), /onclick="[^"\n]*\$\{/);
});
test('record navigation URL-encodes IDs without changing their meaning', () => {
    for (const [name, end] of [['openLiveControl', '        function openBeanPage'], ['openBeanPage', '        async function reanalyzeRecordAndUpdateHome']]) {
        const window = { location: {} };
        const harness = run('roast_db.html', name, end, { window, selectedRecord: null });
        harness.call(attack + '&admin=true#fragment');
        const parsed = new URL(window.location.href, 'https://coffee.test/');
        assert.equal(parsed.searchParams.get('id'), attack + '&admin=true#fragment');
        assert.equal(parsed.searchParams.size, 1);
        assert.equal(parsed.hash, '');
    }
});
