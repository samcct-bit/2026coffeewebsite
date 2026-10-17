const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/ai_engine.js'), 'utf8');
function engine(fetch = async () => { throw new Error('offline'); }) {
    const ctx = vm.createContext({ window: {}, document: { currentScript: { src: 'https://example.test/js/ai_engine.js' } }, URL, console: { log() {}, warn() {}, error() {} }, fetch });
    vm.runInContext(source, ctx);
    // 此組驗證純 AI 邏輯，授權與 token 在 Worker/瀏覽器測試另行涵蓋。
    ctx.authenticatedFetch = fetch;
    return ctx;
}
test('long curve retains drop point, negative excursion and peak beyond first 30 samples', () => {
    const ctx = engine();
    const points = Array.from({ length: 120 }, (_, i) => ({ time: `${i}:00`, bt: 120 + i, ror: i === 82 ? -2 : i === 66 ? 23 : 6 }));
    const summary = ctx._formatRorSummary(points);
    assert.match(summary, /全程抽樣，非完整曲線.*30\/120/);
    for (const time of ['0:00', '66:00', '82:00', '119:00']) assert.ok(summary.includes(`${time}: BT=`));
    assert.equal((summary.match(/BT=/g) || []).length, 30);
});
test('short legacy array curve is not truncated and missing ROR is explicit', () => {
    const ctx = engine();
    const summary = ctx._formatRorSummary([['00:00', 180, 0], ['00:30', 150], ['08:00', 200, 4]]);
    assert.match(summary, /全部觀測點 3\/3/);
    assert.match(summary, /ROR=未計算/);
    assert.equal(ctx._formatRorSummary([]), '');
});
test('insufficient numeric ROR does not call paid API or report good quality', async () => {
    let calls = 0;
    const ctx = engine(async () => { calls++; throw new Error('should not call'); });
    for (const points of [[], [{ time: '08:00', bt: 200 }], [['08:00', 200, 4]]]) {
        const result = await ctx.generateRORDiagnosis({ rorPoints: points });
        assert.equal(result.overallScore, '資料不足');
    }
    assert.equal(calls, 0);
});
test('offline DTR explanation does not claim floral or rounded cup quality', () => {
    const ctx = engine();
    for (const dtr of ['8', '15', '25']) {
        const result = ctx._buildRorDiagnosisFallback({ dtr });
        assert.match(result.dtrEval, /杯測/);
        assert.doesNotMatch(result.dtrEval, /花香較通透|風味會更圓潤|平衡區間/);
    }
});
test('diagnosis receives variety and roast events', async () => {
    let payload;
    const ctx = engine(async (_, options) => {
        payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
    });
    await ctx.generateRORDiagnosis({ variety: 'SL28', fcTime: '07:10', dropTime: '08:20', rorPoints: [['07:10', 190, 6], ['08:20', 200, 4]] });
    assert.match(payload.messages[1].content, /SL28.*07:10.*08:20/);
    assert.equal(payload.temperature, 0.25);
});
test('label flavor limit includes separators', () => {
    const ctx = engine();
    const note = ctx._fitFlavorNote('茉莉花、佛手柑、白桃、紅茶、蜂蜜');
    assert.ok(Array.from(note).length <= 13);
    assert.ok(!note.endsWith('、'));
});
