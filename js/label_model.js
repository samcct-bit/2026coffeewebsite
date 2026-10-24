export const LABEL_FIELDS = Object.freeze(['title', 'english', 'process', 'variety', 'altitude', 'roastLevel', 'flavorTop', 'flavorMid', 'flavorBase']);
export function labelId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('批次 ID 格式不正確');
    return id;
}
export function beanUrl(id) {
    return 'https://2026coffeewebsite.vercel.app/bean.html?id=' + encodeURIComponent(labelId(id));
}
export function labelDefaults(record) {
    return { title: String(record.beanName || ''), english: String(record.nameEn || ''), process: String(record.process || ''),
        variety: String(record.variety || ''), altitude: String(record.altitude || ''), roastLevel: String(record.roastLevel || ''),
        flavorTop: String(record.sensoryProfile?.flavor || record.flavorTop || ''), flavorMid: String(record.sensoryProfile?.mouthfeel || record.flavorMid || ''), flavorBase: String(record.sensoryProfile?.aftertaste || record.flavorBase || '') };
}
export function labelProblems(record, values, quantity) {
    const problems = [];
    if (!record) return ['請先選擇已發布批次'];
    if (!values.title.trim()) problems.push('請填寫標籤豆名');
    if (!values.roastLevel.trim()) problems.push('請確認烘焙度');
    const date = String(record.roastDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) ||
        new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) problems.push('公開資料的烘焙日期無效，請先回後台修訂並發布');
    for (const [key, caption] of [['flavorTop', '初韻'], ['flavorMid', '中調'], ['flavorBase', '尾韻']]) {
        const value = String(values[key] || '');
        if (!value.trim() || Array.from(value).length > 13 || /[\r\n,，;；/／|｜]/.test(value)) problems.push(caption + '須為 1～13 字，含全型頓號；不可含換行或其他分隔符號');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) problems.push('列印張數須為 1～50 的整數');
    return problems;
}
export function qrGeometry(modules, dpi) {
    if (![203, 300].includes(dpi) || !Number.isInteger(modules) || modules < 21 || modules > 177) throw new Error('QR 尺寸參數不正確');
    const totalModules = modules + 8; // Four-module quiet zone on every edge.
    const dotsPerModule = Math.floor(22 / 25.4 * dpi / totalModules);
    return { totalModules, dotsPerModule, sizeMm: totalModules * dotsPerModule * 25.4 / dpi,
        valid: dotsPerModule >= 3 };
}
function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
    return value;
}
export async function fingerprint(record) {
    const bytes = new TextEncoder().encode(JSON.stringify(sorted(record)));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export function labelSnapshot(record, values, hash, dpi) {
    const defaults = labelDefaults(record);
    return { schemaVersion: 1, template: '80x50-qr-sidebar-v1', createdAt: new Date().toISOString(),
        batchId: labelId(record.id), publicationRevision: record.publicationRevision || 0, publicSnapshotSha256: hash,
        publicRecord: record, label: { ...values, roastDate: record.roastDate },
        labelOnlyEdits: LABEL_FIELDS.filter(key => values[key] !== defaults[key]),
        qrTarget: beanUrl(record.id), paperMm: { width: 80, height: 50, margin: 3 }, printerDpi: dpi };
}
