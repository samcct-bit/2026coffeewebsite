const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Run the real page module and DOMContentLoaded callback, without Firebase/CDN/network.
class Element {
    constructor(hidden = false) {
        this.hiddenClasses = new Set(hidden ? ['hidden'] : []);
        this.classList = {
            add: c => this.hiddenClasses.add(c),
            remove: c => this.hiddenClasses.delete(c),
            toggle: (c, force) => force ? this.hiddenClasses.add(c) : this.hiddenClasses.delete(c),
            contains: c => this.hiddenClasses.has(c)
        };
        this.children = [];
        this.style = {};
        this.value = '15';
    }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    appendChild(child) { this.children.push(child); }
    querySelectorAll() { return []; }
}
async function page(file, records = [], search = '') {
    const html = read(file), elements = new Map(), callbacks = [], calls = [];
    for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        elements.set(tag[1], new Element(/class="[^"]*\bhidden\b/.test(tag[0])));
    }
    const document = {
        getElementById: id => { assert.ok(elements.has(id), id); return elements.get(id); },
        querySelector: () => new Element(),
        querySelectorAll: () => [],
        createElement: () => new Element(),
        addEventListener: (event, callback) => { if (event === 'DOMContentLoaded') callbacks.push(callback); }
    };
    const context = vm.createContext({
        document, URL, URLSearchParams, console, setTimeout: () => {},
        window: { location: { search, href: 'https://coffee.test/' + file },
            GansingKimAI: { calculateRORQualityScore: ({ dtr }) => Number(dtr) || 0 } },
        initializeApp: () => ({}), getFirestore: () => ({}),
        collection: (_, name) => { calls.push(name); assert.equal(name, 'coffee_roasts'); return name; },
        doc: (_, name, id) => { calls.push([name, id]); assert.equal(name, 'coffee_roasts'); return id; },
        getDocs: async () => ({ forEach: fn => records.forEach(r => fn({ id: r.id, data: () => r })) }),
        getDoc: async id => ({ id, exists: () => records.some(r => r.id === id), data: () => records.find(r => r.id === id) }),
        IntersectionObserver: class { observe() {} }
    });
    vm.runInContext(read('js/safe_dom.js'), context);
    vm.runInContext(read('js/classic_beans.js').replace('export const', 'const'), context);
    const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;\s*$/gm, '');
    vm.runInContext(module, context, { filename: file });
    for (const callback of callbacks) await callback();
    return { context, calls, el: id => document.getElementById(id),
        cards: () => elements.get('coffee-grid').children.map(c => c.innerHTML).join('\n') };
}
const managed = (id, seconds, extra = {}) => ({ id, beanName: '哥斯大黎加 蕭邦',
    publicationRevision: 1, publishedAt: { seconds, nanoseconds: 0 },
    publicationReview: { sensoryBasis: 'reference' }, flavorTop: '高雅花香：人工保留',
    flavorMid: '', flavorBase: '本批尾韻', storyCopy: '本批故事', ...extra });

test('managed publication beats legacy ROR; latest published Timestamp wins regardless of AI and roast date', async () => {
    const records = [
        { id: 'legacy', beanName: '哥斯大黎加 蕭邦', roastDate: '2099-01-01', dtrRatio: '100', status: 'Optimized', cuppingScore: 99 },
        managed('older', 100, { dtrRatio: '99', publicationRevision: 9, roastDate: '2099-01-02' }),
        managed('latest', 200, { origin: '不同產區寫法', process: '本批處理法' })
    ];
    for (const order of [records, [...records].reverse()]) {
        const p = await page('index.html', order);
        const cards = p.cards();
        assert.match(cards, /bean\.html\?id=latest/);
        assert.doesNotMatch(cards, /bean\.html\?id=(legacy|older)/);
        assert.match(cards, /高雅花香：人工保留/);
        assert.match(cards, /未提供/);
        assert.match(cards, /風味參考・待杯測/);
        const card = p.el('coffee-grid').children.find(c => c.innerHTML.includes('id=latest')).innerHTML;
        assert.doesNotMatch(card, /狂野玫瑰|熟甜香瓜/);
    }
});

test('managed Timestamp nanoseconds sort before id and legacy comparator remains compatible', async () => {
    const p = await page('index.html', [managed('z-old', 100), managed('a-new', 100, { publishedAt: { seconds: 100, nanoseconds: 1 } })]);
    assert.match(p.cards(), /id=a-new/);
    assert.doesNotMatch(p.cards(), /id=z-old/);
    const legacy = await page('index.html', [
        { id: 'ror-best', beanName: '測試同名豆', dtrRatio: '90', roastDate: '2020-01-01' },
        { id: 'recent', beanName: '測試同名豆', dtrRatio: '10', roastDate: '2030-01-01' }
    ]);
    assert.match(legacy.cards(), /id=ror-best/);
    assert.doesNotMatch(legacy.cards(), /id=recent/);
});

test('same-name managed batches consolidate across changed origin/process without a known bean-name alias', async () => {
    const p = await page('index.html', [
        { id: 'generic-legacy', beanName: '新產區 測試豆 #1', origin: '舊寫法', process: '日曬', dtrRatio: '100' },
        managed('generic-old', 10, { beanName: '新產區 測試豆 #2', origin: '新寫法', process: '水洗' }),
        managed('generic-new', 20, { beanName: '新產區 測試豆 #3', origin: '另一寫法', process: '蜜處理', publicationReview: { sensoryBasis: 'cupped' } })
    ]);
    assert.match(p.cards(), /id=generic-new/);
    assert.doesNotMatch(p.cards(), /id=generic-(legacy|old)/);
    assert.match(p.cards(), /本批杯測確認/);
});

test('managed detail preserves reviewed flavor and story without modifying source snapshot', async () => {
    for (const name of ['蕭邦', '莫札特', '瑪格麗特', '陌生豆']) {
        const rec = managed('published', 100, { beanName: name, storyCopy: '微批次精品豆：人工故事', machine: 'Tank-200' });
        const before = JSON.stringify(rec);
        const p = await page('bean.html', [rec], '?id=published');
        assert.equal(p.el('flavor-top').innerText, rec.flavorTop);
        assert.equal(p.el('flavor-mid').innerText, '未提供');
        assert.equal(p.el('story-content').innerHTML, '<p>微批次精品豆：人工故事</p>');
        assert.equal(p.el('story-quote').textContent, '');
        assert.equal(p.el('sensory-basis').textContent, '風味參考・待杯測');
        assert.equal(p.el('attr-machine').innerText, 'Tank-200');
        assert.equal(JSON.stringify(rec), before);
    }
});

test('empty managed story/flavors show 未提供; cupped badge and score do not imply SCA certification', async () => {
    const p = await page('bean.html', [managed('empty', 1, { storyCopy: '  ', flavorTop: '', flavorBase: null,
        publicationReview: { sensoryBasis: 'cupped' }, cuppingScore: 85 })], '?id=empty');
    for (const id of ['flavor-top', 'flavor-mid', 'flavor-base']) assert.equal(p.el(id).innerText, '未提供');
    assert.equal(p.el('story-content').innerHTML, '<p>未提供</p>');
    assert.equal(p.el('sensory-basis').textContent, '本批杯測確認');
    assert.doesNotMatch(p.el('score-label').textContent + p.el('score-description').textContent, /SCA|認證/);
});

test('unknown/missing IDs never select another record or query by name; known static IDs still work', async () => {
    for (const search of ['?id=unpublished-draft', '?id=draft_mozart_003', '']) {
        const p = await page('bean.html', [managed('other', 1)], search);
        assert.equal(p.el('bean-detail').classList.contains('hidden'), true);
        assert.equal(p.el('publication-empty').classList.contains('hidden'), false);
        assert.match(p.el('header-bean-title').textContent, /尚未發布或找不到/);
        assert.ok(p.calls.every(call => Array.isArray(call)));
    }
    for (const id of ['mozart', 'roast_003']) {
        const p = await page('bean.html', [], '?id=' + id);
        assert.equal(p.el('bean-detail').classList.contains('hidden'), false);
        assert.match(p.el('header-bean-title').innerText, /莫札特/);
    }
});

test('dynamic cards/story escape HTML and links encode IDs / reject script URLs', async () => {
    const attack = `<img src=x onerror="alert('x')">&`;
    const rec = managed('id"&?', 1, { beanName: attack, flavorTop: attack, storyCopy: attack, dashboardUrl: 'javascript:alert(1)' });
    const home = await page('index.html', [rec]);
    assert.ok(home.cards().includes('&lt;img'));
    assert.ok(!home.cards().includes(attack));
    assert.ok(home.cards().includes('id=id%22%26%3F'));
    const detail = await page('bean.html', [rec], '?id=' + encodeURIComponent(rec.id));
    assert.match(detail.el('story-content').innerHTML, /&lt;img.*&quot;.*&#39;/);
    assert.equal(detail.el('btn-view-dashboard').href, '#');
});
