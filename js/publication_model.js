// Public snapshots contain only reviewed customer-facing fields.
export const PUBLIC_FIELDS = Object.freeze([
    'id', 'beanName', 'nameEn', 'origin', 'machine', 'roastDate', 'process', 'altitude', 'variety', 'cropYear',
    'roastLevel', 'chargeMassG', 'dropMassG', 'chargeTemp', 'tpTemp', 'tpTime', 'fcTemp', 'fcTime',
    'dropTemp', 'dropTime', 'dtrRatio', 'lossRatio', 'flavorTop', 'flavorMid', 'flavorBase', 'storyCopy',
    'brewTemp', 'brewMethod', 'brewAiTip', 'brewGuideNote', 'cuppingScore', 'rorDatapointsJson',
    'timelineActionsJson', 'rorQualityScore', 'imageUrl', 'image', 'beanImage', 'dashboardUrl',
    'aiAnalyzedAt', 'aiAnalysisVersion', 'sensoryProfile'
]);
const META = new Set(['publicationRevision', 'publishedAt', 'publishedBy', 'sourceDraftVersion', 'publicationReview']);
export const REVIEW_FIELDS = Object.freeze(['identityConfirmed', 'flavorReviewed', 'evidenceLimitationsAccepted']);
function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function normalizeFlavor(value) {
    return String(value ?? '').normalize('NFC').replace(/[，,;；/|]+/g, '、').replace(/\s+/g, '').replace(/、+/g, '、').replace(/^、|、$/g, '');
}
export function preparePayload(record) {
    const entries = Object.entries(record || {}).filter(([key, value]) =>
        !key.startsWith('_') && !META.has(key) && !['__proto__', 'prototype', 'constructor'].includes(key) && value !== undefined);
    const result = JSON.parse(JSON.stringify(Object.fromEntries(entries)));
    if (Array.isArray(result.rorDatapoints)) result.rorDatapointsJson = JSON.stringify(result.rorDatapoints);
    if (Array.isArray(result.timelineActions)) result.timelineActionsJson = JSON.stringify(result.timelineActions);
    delete result.rorDatapoints;
    delete result.timelineActions;
    for (const key of ['flavorTop', 'flavorMid', 'flavorBase']) {
        if (typeof result[key] === 'string') result[key] = normalizeFlavor(result[key]);
    }
    return result;
}
export function publicationProblems(record, review) {
    const problems = [];
    if (typeof record.beanName !== 'string' || !record.beanName.trim() || record.beanName.length > 240) problems.push('請填寫 240 字以內的豆名');
    if (!validDate(record.roastDate)) problems.push('請填寫有效的烘焙日期');
    for (const [key, label] of [['flavorTop', '初韻'], ['flavorMid', '中調'], ['flavorBase', '尾韻']]) {
        const value = normalizeFlavor(record[key]);
        if (typeof record[key] !== 'string' || !value || Array.from(value).length > 13) problems.push(label + '須為 1～13 字（含頓號），請先編輯草稿');
    }
    if (String(record.storyCopy || '').length > 6000) problems.push('故事文案請縮短至 6000 字內');
    if (record.sensoryProfile !== undefined) {
        const profile = record.sensoryProfile;
        if (!profile || profile.method !== 'solo' || !['single', 'repeated'].includes(profile.status) ||
            !Array.isArray(profile.dates) || profile.dates.length !== (profile.status === 'repeated' ? 2 : 1) || !profile.dates.every(validDate) ||
            Object.keys(profile).some(key => !['method', 'status', 'dates', 'flavor', 'mouthfeel', 'aftertaste'].includes(key))) problems.push('杯測摘要格式不正確');
        for (const [key, alias] of [['flavor', 'flavorTop'], ['mouthfeel', 'flavorMid'], ['aftertaste', 'flavorBase']]) {
            if (typeof profile?.[key] !== 'string' || !profile[key] || Array.from(profile[key]).length > 13 || profile[key] !== record[alias]) problems.push('杯測摘要與公開描述不符，請回杯測工具重新採用');
        }
    }
    for (const key of ['nameEn', 'origin', 'machine', 'process', 'altitude', 'variety', 'cropYear', 'roastLevel',
        'storyCopy', 'brewTemp', 'brewMethod', 'brewAiTip', 'brewGuideNote', 'rorDatapointsJson', 'timelineActionsJson']) {
        if (record[key] !== undefined && typeof record[key] !== 'string') problems.push(key + ' 必須是文字');
    }
    if (review) {
        if (!REVIEW_FIELDS.every(key => review[key] === true)) problems.push('請完成三項人工審核確認');
        if (!['reference', 'cupped'].includes(review.sensoryBasis)) problems.push('請選擇風味依據');
        if (review.sensoryBasis === 'cupped' && !validDate(review.cuppingDate)) problems.push('本批杯測確認須填寫有效杯測日期');
        if (review.sensoryBasis === 'cupped' && (!record.sensoryProfile || !Array.isArray(record.cuppingSessionIds) || record.cuppingSessionIds.length < 1 || record.cuppingSessionIds.length > 2)) problems.push('請先在單人杯測工具鎖定原始紀錄並採用摘要，再確認本批杯測');
        if (record.sensoryProfile && review.sensoryBasis !== 'cupped') problems.push('此草稿帶有杯測摘要，請以本批杯測發布，或先移除杯測依據');
        if (Array.isArray(record.sensoryProfile?.dates) && review.cuppingDate !== [...record.sensoryProfile.dates].sort().at(-1)) problems.push('杯測日期須與最新已採用場次一致');
    }
    return problems;
}
export function buildPublicSnapshot(record, review, metadata) {
    const payload = preparePayload(record);
    const problems = publicationProblems(payload, review);
    if (problems.length) throw new Error(problems.join('\n'));
    const snapshot = Object.fromEntries(PUBLIC_FIELDS.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]));
    for (const key of ['flavorTop', 'flavorMid', 'flavorBase']) snapshot[key] = normalizeFlavor(payload[key]);
    if (review.sensoryBasis !== 'cupped' || payload.sensoryProfile?.method === 'solo') snapshot.cuppingScore = 0;
    const publicReview = Object.fromEntries(REVIEW_FIELDS.map(key => [key, true]));
    publicReview.sensoryBasis = review.sensoryBasis;
    publicReview.cuppingDate = review.sensoryBasis === 'cupped' ? review.cuppingDate : '';
    return { ...snapshot, ...metadata, publicationReview: publicReview };
}
export function publishedRevision(record) {
    return Number.isInteger(record?.publicationRevision) ? record.publicationRevision : 0;
}
export function workspaceRecord(id, published, envelope) {
    const result = { ...(published || {}), ...(envelope?.payload || {}), id };
    for (const [array, json] of [['rorDatapoints', 'rorDatapointsJson'], ['timelineActions', 'timelineActionsJson']]) {
        try { result[array] = JSON.parse(result[json] || '[]'); } catch { result[array] = []; }
    }
    result._workspace = { version: envelope?.draftVersion || null, hasDraft: envelope?.status === 'draft',
        publishedExists: !!published, publishedRevision: publishedRevision(published),
        basePublishedRevision: envelope?.basePublishedRevision ?? publishedRevision(published),
        source: envelope?.source || 'legacy', published: published || null };
    return result;
}
