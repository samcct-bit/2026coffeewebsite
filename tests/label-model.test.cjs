const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const qrcode = require('../js/vendor/qrcode-1.4.4.js');
let model;
const record = { id: 'roast_1785567096800', beanName: '白岩莊園', nameEn: 'Java Natural', roastDate: '2026-08-01',
    roastLevel: '淺焙', flavorTop: '茉莉、藍莓', flavorMid: '蜂蜜、果汁感', flavorBase: '可可、回甘', publicationRevision: 2 };
before(async () => { model = await import(pathToFileURL(path.resolve('js/label_model.js')).href); });
test('QR target is the exact batch on the canonical origin, never an imported URL', () => {
    assert.equal(model.beanUrl(record.id), 'https://2026coffeewebsite.vercel.app/bean.html?id=roast_1785567096800');
    for (const id of ['../other', '" onclick="x', 'https://evil.test', '']) assert.throws(() => model.beanUrl(id));
});
test('13 codepoints includes fullwidth separators; invalid date and quantity are blocked', () => {
    const values = model.labelDefaults(record); values.flavorTop = '一二三四五六、七八九十甲乙';
    assert.deepEqual(model.labelProblems(record, values, 1), []);
    assert.match(model.labelProblems(record, { ...values, flavorTop: values.flavorTop + '丙' }, 1).join(), /13/);
    for (const text of ['柑橘,蜂蜜', '柑橘／蜂蜜', '柑橘\n蜂蜜', '', '柑橘/蜂蜜', '柑橘｜蜂蜜']) assert.ok(model.labelProblems(record, { ...values, flavorTop: text }, 1).length);
    for (const count of [0, 51, 1.5, NaN]) assert.ok(model.labelProblems(record, values, count).length);
    assert.match(model.labelProblems({ ...record, roastDate: '2026-02-30' }, values, 1).join(), /日期/);
});
test('QR uses 4-module quiet zone and whole dots at 203 / 300 dpi', () => {
    for (const id of [record.id, 'roast_20260510_tank200_new_Kenya-B4']) {
        const qr = qrcode(0, 'M'); qr.addData(model.beanUrl(id), 'Byte'); qr.make();
        for (const dpi of [203, 300]) {
            const geometry = model.qrGeometry(qr.getModuleCount(), dpi);
            assert.equal(geometry.totalModules, qr.getModuleCount() + 8);
            assert.ok(geometry.valid); assert.ok(geometry.sizeMm <= 22);
            assert.ok(Number.isInteger(geometry.dotsPerModule)); assert.ok(geometry.dotsPerModule >= 3);
        }
    }
    assert.equal(model.qrGeometry(177, 203).valid, false);
    const long = qrcode(0, 'M'); long.addData(model.beanUrl('x'.repeat(180))); long.make();
    assert.equal(model.qrGeometry(long.getModuleCount(), 203).valid, false);
    assert.equal(model.qrGeometry(long.getModuleCount(), 300).valid, true);
});
test('snapshot preserves batch, revision and local edits without changing source', async () => {
    const original = JSON.stringify(record), hash = await model.fingerprint(record);
    assert.equal(hash.length, 64);
    assert.equal(hash, await model.fingerprint(Object.fromEntries(Object.entries(record).reverse())));
    assert.notEqual(hash, await model.fingerprint({ ...record, flavorTop: '不同內容' }));
    const snapshot = model.labelSnapshot(record, { ...model.labelDefaults(record), title: '標籤短名' }, hash, 203);
    assert.deepEqual(snapshot.labelOnlyEdits, ['title']);
    assert.equal(snapshot.publicationRevision, 2); assert.equal(snapshot.publicSnapshotSha256, hash);
    assert.equal(snapshot.qrTarget, model.beanUrl(record.id)); assert.equal(snapshot.label.roastDate, record.roastDate);
    assert.equal(JSON.stringify(record), original);
});
