const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let model;
const roast = { id: 'solo-model', beanName: '測試豆', roastDate: '2026-10-17', fcTime: '08:00', dropTime: '09:30' };
before(async () => { model = await import(pathToFileURL(path.resolve('js/cupping_model.js')).href); });
function form(date = '2026-10-20') {
    const value = model.blankForm(date); Object.assign(value, { greenLot: 'LOT-01', grinder: '測試磨豆機', grindSetting: '20', waterSource: '同批水', referenceHidden: true, conditionsConfirmed: true });
    value.cups.forEach(cup => cup.rounds.forEach(round => Object.assign(round, { flavor: '柑橘、花香', mouthfeel: '滑順、中等厚度', aftertaste: '紅茶、回甘' })));
    return value;
}
async function session(id = 'session-1', date) { return { id, batchId: roast.id, status: 'locked', roastFingerprint: await model.roastFingerprint(roast), form: form(date) }; }
test('no color meter means no synthetic Agtron; development comes from valid absolute events', () => {
    assert.equal(model.developmentSeconds(roast), 90);
    assert.equal(model.developmentSeconds({ fcTime: '0:00', dropTime: '09:30' }), null);
    assert.equal(model.developmentSeconds({ fcTime: '08:70', dropTime: '09:30' }), null);
    assert.equal(model.blankForm().cups.length, 3);
    assert.equal(Object.hasOwn(model.blankForm(), 'cuppingScore'), false);
});
test('incomplete observations can be drafted, but lock requires actual conditions and three rounds per cup', () => {
    const empty = model.blankForm('2026-10-20');
    assert.deepEqual(model.formProblems(empty, roast.roastDate), []);
    assert.ok(model.formProblems(empty, roast.roastDate, true).length);
    assert.deepEqual(model.formProblems(form(), roast.roastDate, true), []);
    assert.ok(model.formProblems({ ...form(), date: '2026-02-30' }, roast.roastDate, true).length);
});
test('malformed imported observations fail with validation errors, not incidental type errors', async () => {
    const value = form(); value.cups[0] = null;
    assert.ok(model.formProblems(value, roast.roastDate, true).length);
    await assert.rejects(model.buildSensoryProfile(roast, [null], {}), /場次格式不正確/);
    const a = await session(); a.form = null;
    await assert.rejects(model.buildSensoryProfile(roast, [a, await session('b', '2026-10-22')], {}), /表格格式不正確/);
});
test('three repetitions within one cup do not count as two independent cups', async () => {
    const one = await session(); one.form.cups[1].rounds.forEach(r => r.flavor = '未辨識'); one.form.cups[2].rounds.forEach(r => r.flavor = '不確定');
    assert.deepEqual(model.repeatableTerms(one, 'flavor'), []);
    one.form.cups[1].rounds[0].flavor = '柑橘'; assert.deepEqual(model.repeatableTerms(one, 'flavor'), ['柑橘']);
});
test('solo repeat confirmation requires different dates, matching recipe and stable roast identity', async () => {
    const a = await session('a'), b = await session('b', '2026-10-22');
    assert.deepEqual(await model.evidenceProblems(roast, [a, b]), []);
    assert.ok((await model.evidenceProblems(roast, [a, a])).length);
    assert.ok((await model.evidenceProblems({ ...roast, dropTime: '09:45' }, [a])).length);
    b.form.waterSource = '另一配方'; assert.ok((await model.evidenceProblems(roast, [a, b])).length);
});
test('only observed category-specific repeated terms can become <=13-char public descriptors', async () => {
    const a = await session('a'), b = await session('b', '2026-10-22');
    const result = await model.buildSensoryProfile(roast, [a, b], { flavor: '柑橘、花香', mouthfeel: '滑順', aftertaste: '紅茶、回甘' });
    assert.equal(result.status, 'repeated'); assert.equal(result.method, 'solo'); assert.equal(result.cuppingScore, undefined);
    await assert.rejects(model.buildSensoryProfile(roast, [a], { flavor: '草莓', mouthfeel: '滑順', aftertaste: '紅茶' }), /未支持/);
    await assert.rejects(model.buildSensoryProfile(roast, [a], { flavor: '柑橘', mouthfeel: '花香', aftertaste: '紅茶' }), /未支持/);
    b.form.cups.forEach(cup => cup.rounds.forEach(r => r.flavor = '另一觀察'));
    assert.deepEqual(model.profileCandidates([a, b]).flavor, []);
});
