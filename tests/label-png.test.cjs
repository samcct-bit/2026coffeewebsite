const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let png;
const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
before(async () => { png = await import(pathToFileURL(path.resolve('js/label_png.js')).href); });
function chunks(bytes) {
    const result = [];
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
        result.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length), raw: bytes.subarray(offset, offset + 12 + length) });
        offset += 12 + length;
    }
    return result;
}
test('80x50 mm PNG has printer-specific integer pixel dimensions', () => {
    assert.deepEqual(png.pngDimensions(203), { width: 639, height: 400 });
    assert.deepEqual(png.pngDimensions(300), { width: 945, height: 591 });
    assert.throws(() => png.pngDimensions(96));
});
test('PNG pHYs metadata preserves image chunks, replaces density and precedes IDAT', async () => {
    for (const dpi of [203, 300]) {
        const output = Buffer.from(await (await png.setPngDpi(new Blob([fixture]), dpi)).arrayBuffer());
        const parts = chunks(output), phys = parts.find(part => part.type === 'pHYs');
        assert.equal(parts.filter(part => part.type === 'pHYs').length, 1);
        assert.equal(phys.data.readUInt32BE(0), Math.round(dpi / .0254));
        assert.equal(phys.data.readUInt32BE(4), Math.round(dpi / .0254)); assert.equal(phys.data[8], 1);
        assert.ok(parts.indexOf(phys) < parts.findIndex(part => part.type === 'IDAT'));
        for (const type of ['IHDR', 'IDAT', 'IEND']) assert.deepEqual(parts.find(part => part.type === type).raw, chunks(fixture).find(part => part.type === type).raw);
        const twice = Buffer.from(await (await png.setPngDpi(new Blob([output]), 300)).arrayBuffer());
        assert.equal(chunks(twice).filter(part => part.type === 'pHYs').length, 1);
    }
});
test('malformed PNG and unsupported density fail without producing a fake file', async () => {
    await assert.rejects(png.setPngDpi(new Blob(['not png']), 300), /格式/);
    await assert.rejects(png.setPngDpi(new Blob([fixture.subarray(0, 29)]), 300), /不完整|缺少/);
    await assert.rejects(png.setPngDpi(new Blob([fixture]), 96), /203/);
});
