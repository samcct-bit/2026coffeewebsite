export const CATEGORIES = Object.freeze(['flavor', 'mouthfeel', 'aftertaste']);
export const ROUNDS = Object.freeze(['熱（適口）', '溫', '涼']);
export const CATEGORY_NAMES = Object.freeze({ flavor: '風味', mouthfeel: '口感', aftertaste: '餘韻' });
export function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function taipeiDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function blankForm(date = taipeiDate()) {
    return { date, greenLot: '', grinder: '', grindSetting: '', waterSource: '', doseG: 11, vesselMl: 200, waterTempC: 93,
        referenceHidden: false, conditionsConfirmed: false, qualityNote: '', cups: Array.from({ length: 3 }, () => ({ concern: '',
            rounds: Array.from({ length: 3 }, () => ({ flavor: '', mouthfeel: '', aftertaste: '', temperature: '', aftertasteSeconds: '' })) })) };
}
export function roastIdentity(record) {
    const result = Object.fromEntries(['id', 'beanName', 'roastDate', 'machine', 'origin', 'process', 'variety', 'greenLotId',
        'chargeMassG', 'dropMassG', 'chargeTemp', 'fcTime', 'dropTime', 'rorDatapointsJson'].map(key => [key, record[key] ?? null]));
    try { result.rorDatapointsJson = JSON.stringify(JSON.parse(record.rorDatapointsJson || '[]')); }
    catch { result.rorDatapointsJson = record.rorDatapointsJson; }
    return result;
}
export async function roastFingerprint(record) {
    const data = new TextEncoder().encode(JSON.stringify(roastIdentity(record)));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function developmentSeconds(record) {
    const seconds = value => {
        const match = /^(\d{1,3}):([0-5]\d)$/.exec(String(value || ''));
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const start = seconds(record.fcTime), end = seconds(record.dropTime);
    return start !== null && start > 0 && end !== null && end >= start ? end - start : null;
}
export function formProblems(form, roastDate, locking = false) {
    const problems = [];
    if (!form || typeof form !== 'object') return ['杯測表格格式不正確'];
    if (!validDate(form.date) || form.date < roastDate || form.date > taipeiDate()) problems.push('杯測日期須有效、不得早於烘焙日或晚於今天');
    for (const key of ['greenLot', 'grinder', 'grindSetting', 'waterSource', 'qualityNote']) {
        if (typeof form[key] !== 'string' || form[key].length > 500) problems.push(key + ' 須為 500 字內文字');
        else if (locking && key !== 'qualityNote' && !form[key].trim()) problems.push('請完成 lot、磨豆機、刻度與用水紀錄');
    }
    for (const [key, min, max] of [['doseG', 1, 100], ['vesselMl', 50, 1000], ['waterTempC', 1, 100]]) {
        if (typeof form[key] !== 'number' || !Number.isFinite(form[key]) || form[key] < min || form[key] > max) problems.push('粉量、杯容量或水溫不正確');
    }
    if (typeof form.referenceHidden !== 'boolean' || typeof form.conditionsConfirmed !== 'boolean') problems.push('確認欄位格式不正確');
    if (locking && !form.conditionsConfirmed) problems.push('請確認已填寫實際沖煮條件，預設數字不是實測結果');
    if (!Array.isArray(form.cups) || form.cups.length !== 3) return [...problems, '每場須有三杯獨立紀錄'];
    for (const [i, cup] of form.cups.entries()) {
        if (!cup || typeof cup !== 'object') { problems.push('逐杯紀錄格式不正確'); continue; }
        if (typeof cup.concern !== 'string' || cup.concern.length > 500) problems.push('逐杯異常紀錄須為 500 字內文字');
        if (!Array.isArray(cup.rounds) || cup.rounds.length !== 3) { problems.push('每杯須有熱、溫、涼三輪'); continue; }
        for (const round of cup.rounds) {
            if (!round || typeof round !== 'object') { problems.push('逐輪紀錄格式不正確'); continue; }
            for (const key of CATEGORIES) if (typeof round[key] !== 'string' || round[key].length > 300 || (locking && !round[key].trim())) problems.push(`杯 ${i + 1} 請完成三輪觀察；無法辨識時可填「未辨識」，不用猜測`);
            for (const [key, max] of [['temperature', 100], ['aftertasteSeconds', 600]]) if (typeof round[key] !== 'string' || round[key].length > 10 ||
                (round[key] !== '' && (!Number.isFinite(Number(round[key])) || Number(round[key]) < 0 || Number(round[key]) > max))) problems.push('品飲溫度或餘韻秒數格式不正確');
        }
    }
    return [...new Set(problems)];
}
export function repeatableTerms(session, category) {
    const counts = new Map();
    for (const cup of session.form.cups) {
        const seen = new Set(cup.rounds.flatMap(round => String(round[category] || '').split(/[、,，;；\n]/).map(text => text.normalize('NFC').replace(/\s+/g, '')).filter(text => text && !['無', '未辨識', '不確定', '待確認', '無法辨識'].includes(text))));
        for (const term of seen) counts.set(term, (counts.get(term) || 0) + 1);
    }
    return [...counts].filter(([, count]) => count >= 2).map(([term]) => term);
}
export function profileCandidates(sessions) {
    return Object.fromEntries(CATEGORIES.map(category => [category, sessions.length ? repeatableTerms(sessions[0], category)
        .filter(term => sessions.every(session => repeatableTerms(session, category).includes(term))) : []]));
}
export async function evidenceProblems(record, sessions) {
    const problems = [];
    if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > 2) return ['請選擇一或兩場已鎖定杯測'];
    if (sessions.some(session => !session || typeof session !== 'object')) return ['杯測場次格式不正確'];
    if (new Set(sessions.map(s => s.id)).size !== sessions.length) problems.push('不能重複使用同一場杯測');
    const signature = await roastFingerprint(record);
    for (const session of sessions) {
        if (session.status !== 'locked' || session.batchId !== record.id || session.roastFingerprint !== signature) problems.push('杯測未鎖定、批次不符或烘焙資料已變更');
        problems.push(...formProblems(session.form, record.roastDate, true));
    }
    if (problems.length) return [...new Set(problems)];
    if (sessions.length === 2) {
        if (sessions[0].form.date === sessions[1].form.date) problems.push('單人複測須選擇不同日期的兩場紀錄');
        for (const key of ['greenLot', 'grinder', 'grindSetting', 'waterSource', 'doseG', 'vesselMl']) if (sessions[0].form[key] !== sessions[1].form[key]) problems.push('複測的 lot、用水、研磨與配比條件須一致');
        if (Math.abs(sessions[0].form.waterTempC - sessions[1].form.waterTempC) > 3) problems.push('複測注水溫度差須在 3°C 內（店內比較條件，不代表認證）');
    }
    return [...new Set(problems)];
}
export async function buildSensoryProfile(record, sessions, words) {
    const problems = await evidenceProblems(record, sessions);
    if (problems.length) throw new Error(problems.join('；'));
    const candidates = profileCandidates(sessions);
    const result = { method: 'solo', status: sessions.length === 2 ? 'repeated' : 'single', dates: sessions.map(s => s.form.date).sort() };
    for (const key of CATEGORIES) {
        const value = typeof words?.[key] === 'string' ? words[key].normalize('NFC').replace(/\s+/g, '') : '';
        const terms = value.split('、');
        if (!value || Array.from(value).length > 13 || terms.some(term => !term || !candidates[key].includes(term))) problems.push(CATEGORY_NAMES[key] + '須從重現詞選取並以頓號分隔，總長 1～13 字；不能加入原始紀錄未支持的詞');
        result[key] = value;
    }
    if (problems.length) throw new Error([...new Set(problems)].join('；'));
    return result;
}
