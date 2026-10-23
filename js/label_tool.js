import { db } from './firebase_config.js';
import { getAdminToken, login, mountAdminUI } from './admin_auth.js';
import { collection, doc, getDocs, getDocFromServer } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { LABEL_FIELDS, beanUrl, labelDefaults, labelProblems, qrGeometry, fingerprint, labelSnapshot } from './label_model.js';
import { renderLabelPng } from './label_png.js';

const $ = id => document.getElementById(id);
let records = [], record = null, sourceHash = '', values = {}, generation = 0, loadVersion = 0, busy = false, armedUntil = 0, operationMessage = '';
const captions = { title: '中文豆名（可用已確認短名）', english: '英文短名（可留白）', process: '處理法', variety: '品種',
    altitude: '海拔（可留白）', roastLevel: '烘焙度', flavorTop: '初韻', flavorMid: '中調', flavorBase: '尾韻' };
const qrCache = new Map();
function el(tag, text, className = '') {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    node.className = className;
    return node;
}
function authorized() { return $('password-overlay').style.display === 'none'; }
function invalidate() {
    generation++; armedUntil = 0; operationMessage = '';
    document.body.classList.add('print-blocked'); $('print-root').replaceChildren();
    $('reviewed').checked = false; $('calibrated').checked = false;
}
function qrCode(id) {
    const url = beanUrl(id);
    if (!qrCache.has(url)) {
        const qr = window.qrcode(0, 'M'); qr.addData(url, 'Byte'); qr.make(); qrCache.set(url, qr);
    }
    return qrCache.get(url);
}
function qrSvg(qr, geometry) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${geometry.totalModules} ${geometry.totalModules}`);
    svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '此批次豆款頁 QR Code');
    svg.classList.add('label-qr'); svg.style.width = geometry.sizeMm + 'mm'; svg.style.height = geometry.sizeMm + 'mm';
    const white = document.createElementNS(ns, 'rect');
    white.setAttribute('width', '100%'); white.setAttribute('height', '100%'); white.setAttribute('fill', '#fff'); svg.append(white);
    const path = document.createElementNS(ns, 'path'); let d = '';
    for (let row = 0; row < qr.getModuleCount(); row++) for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`;
    }
    path.setAttribute('d', d); path.setAttribute('fill', '#000'); svg.append(path); return svg;
}
function fitted(tag, text, className) {
    const node = el(tag, text, className); node.dataset.fit = 'true'; return node;
}
function render() {
    const preview = $('preview'); preview.replaceChildren(); $('qr-status').textContent = '';
    if (!record) { preview.append(el('p', '請先登入並選擇已發布批次。', 'hint')); validate(); return; }
    const label = el('article', undefined, 'label'); label.setAttribute('aria-label', '80 × 50 mm 標籤');
    const head = el('header', undefined, 'label-head');
    const logo = el('img', undefined, 'label-logo'); logo.src = './7204.webp'; logo.alt = '金成淬品牌章';
    logo.addEventListener('load', validate); logo.addEventListener('error', validate);
    const titles = el('div', undefined, 'label-titles');
    titles.append(fitted('div', '金成淬 · GAN-SÎNG-KIM', 'label-brand'), fitted('div', values.title, 'label-title'), fitted('div', values.english, 'label-english'));
    head.append(logo, titles);
    const body = el('div', undefined, 'label-body'); const copy = el('div', undefined, 'label-copy');
    copy.append(fitted('div', '處理：' + (values.process || '未提供'), 'label-meta'),
        fitted('div', '品種：' + (values.variety || '未提供') + (values.altitude ? '｜' + values.altitude : ''), 'label-meta'));
    const notes = el('section', undefined, 'label-notes');
    for (const [key, caption] of [['flavorTop', '初韻'], ['flavorMid', '中調'], ['flavorBase', '尾韻']]) {
        const row = el('div', undefined, 'label-row'); row.append(el('span', caption, 'label-caption'), fitted('span', values[key], 'label-flavor')); notes.append(row);
    }
    copy.append(notes); const side = el('aside', undefined, 'label-side');
    try {
        const qr = qrCode(record.id), geometry = qrGeometry(qr.getModuleCount(), Number($('dpi').value));
        side.append(qrSvg(qr, geometry));
        $('qr-status').textContent = `QR：${qr.getModuleCount()} × ${qr.getModuleCount()} 模組；${geometry.dotsPerModule} 點／模組；含淨空 ${geometry.sizeMm.toFixed(1)} mm。`;
        side.dataset.valid = String(geometry.valid);
    } catch { side.dataset.valid = 'false'; $('qr-status').textContent = 'QR 產生失敗，不能列印。'; }
    body.append(copy, side);
    const foot = el('footer', undefined, 'label-foot'); const left = el('div');
    left.append(fitted('div', values.roastLevel + '｜烘焙 ' + record.roastDate.replaceAll('-', '.'), 'label-date'));
    const right = el('div');
    right.append(fitted('div', '批次尾碼 ' + record.id.slice(-8) + ' · v' + (record.publicationRevision || 0), 'label-batch'));
    right.append(fitted('div', record.publicationReview?.sensoryBasis === 'cupped' ? '風味依據：本批杯測確認' : '風味參考・待杯測', 'label-basis'));
    foot.append(left, right); label.append(head, body, foot); preview.append(label);
    $('edit-warning').hidden = !LABEL_FIELDS.some(key => values[key] !== labelDefaults(record)[key]);
    $('public-link').hidden = false; $('public-link').href = beanUrl(record.id);
    requestAnimationFrame(validate);
}
function validate() {
    const problems = labelProblems(record, values, Number($('quantity').value));
    if (record) {
        const label = $('preview').querySelector('.label');
        const overflow = label ? [...label.querySelectorAll('[data-fit]')].filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) : [];
        if (overflow.length) problems.push('文字超出版面，請縮短標籤文字或清空英文／海拔，不會自動裁切。');
        const logo = label?.querySelector('img');
        if (!logo?.complete || !logo.naturalWidth) problems.push('品牌章尚未成功載入');
        if (label?.querySelector('.label-side')?.dataset.valid !== 'true') problems.push('此網址的 QR 在所選解析度下過密，請改用 300 dpi 或先建立短網址；不會縮小到不足 3 點／模組。');
    }
    if (!authorized()) problems.push('請先登入管理員');
    if (!$('reviewed').checked || !$('calibrated').checked) problems.push('請完成兩項印前確認');
    $('print').disabled = $('download').disabled = $('download-png').disabled = busy || problems.length > 0;
    $('validation').textContent = [operationMessage, problems.length ? problems.join('\n') : '檢查通過；實際試印確認後再大量列印。'].filter(Boolean).join('\n');
    $('validation').className = problems.length || operationMessage ? 'invalid' : '';
    return problems.length === 0;
}
for (const key of LABEL_FIELDS) {
    const label = el('label', captions[key]); label.htmlFor = 'field-' + key;
    const input = el('input'); input.id = 'field-' + key; input.type = 'text'; input.autocomplete = 'off'; input.disabled = true;
    const counter = el('span', '', 'field-counter'); if (key.startsWith('flavor')) label.append(counter);
    input.addEventListener('input', () => {
        invalidate(); values[key] = input.value;
        if (key.startsWith('flavor')) { counter.textContent = Array.from(input.value).length + '/13'; input.setAttribute('aria-invalid', String(Array.from(input.value).length > 13)); }
        render();
    });
    $('fields').append(label, input);
}
function fillFields() {
    for (const key of LABEL_FIELDS) {
        const input = $('field-' + key); input.disabled = !record; input.value = values[key] || '';
        input.removeAttribute('aria-invalid');
        if (key.startsWith('flavor')) input.previousElementSibling.querySelector('span').textContent = Array.from(input.value).length + '/13';
    }
}
async function select(id) {
    invalidate(); record = null; sourceHash = ''; $('public-link').hidden = true; $('edit-warning').hidden = true;
    const version = generation, selected = records.find(item => item.id === id);
    values = {}; fillFields(); render();
    const hash = selected ? await fingerprint(selected) : '';
    if (version !== generation) return;
    record = selected || null; sourceHash = hash; values = selected ? labelDefaults(selected) : {};
    fillFields(); render();
    $('source-status').textContent = record ? `批次：${record.id}；公開版本 ${record.publicationRevision || 0}${record.publicationRevision ? '' : '（舊版資料，請核對後再印）'}。` : '未選擇批次；草稿不會出現在此工具。';
}
function filterOptions(selectedId = $('batch-select').value) {
    const term = $('batch-search').value.trim().toLocaleLowerCase();
    const items = records.filter(item => (item.beanName + ' ' + item.id).toLocaleLowerCase().includes(term));
    $('batch-select').replaceChildren();
    const blank = el('option', '請選擇已發布批次'); blank.value = ''; $('batch-select').append(blank);
    for (const item of items) { const option = el('option', `${item.roastDate || '無日期'}｜${item.beanName}｜${item.id}`); option.value = item.id; $('batch-select').append(option); }
    $('batch-select').value = items.some(item => item.id === selectedId) ? selectedId : '';
    if ($('batch-select').value !== record?.id) select($('batch-select').value);
}
async function reload() {
    const version = ++loadVersion, selectedId = record?.id || new URL(location.href).searchParams.get('id') || '';
    invalidate(); records = []; await select(''); $('source-status').textContent = '正在讀取公開資料…';
    try {
        await getAdminToken();
        const snapshot = await getDocs(collection(db, 'coffee_roasts'));
        if (version !== loadVersion) return;
        records = snapshot.docs.map(item => ({ ...item.data(), id: item.id })).sort((a, b) => String(b.roastDate).localeCompare(String(a.roastDate)));
        filterOptions(selectedId); await select($('batch-select').value);
        if (selectedId && !records.some(item => item.id === selectedId)) $('source-status').textContent = '指定批次尚未發布或已下架，不能列印；請另選公開批次。';
    } catch { if (version === loadVersion) { records = []; filterOptions(''); await select(''); $('source-status').textContent = '無法載入公開資料，請確認登入與網路後重試；不使用離線資料列印。'; } }
}
async function verifyFresh() {
    const version = generation, current = record;
    if (!validate()) throw new Error('請先完成印前檢查');
    await getAdminToken();
    const latest = await getDocFromServer(doc(db, 'coffee_roasts', current.id));
    if (version !== generation) throw new Error('設定已變更，請重新確認');
    if (!latest.exists() || await fingerprint({ ...latest.data(), id: latest.id }) !== sourceHash) {
        invalidate(); throw new Error('公開批次已更新或下架，請重新載入再核對；本次未送印。');
    }
    if (version !== generation || !authorized()) throw new Error('設定或登入狀態已變更，請重新確認');
    return current;
}
async function action(callback) {
    if (busy) return;
    try {
        if (!validate()) return;
        busy = true; operationMessage = ''; $('print').disabled = $('download').disabled = $('download-png').disabled = true;
        await callback(await verifyFresh());
    } catch (error) { operationMessage = error.message || '操作失敗，未修改資料'; }
    finally { busy = false; validate(); }
}
$('print').addEventListener('click', () => action(async () => {
    const version = generation;
    await document.fonts.ready;
    if (version !== generation || !validate()) return;
    const root = $('print-root'); root.replaceChildren();
    for (let i = 0; i < Number($('quantity').value); i++) root.append($('preview').querySelector('.label').cloneNode(true));
    armedUntil = Date.now() + 30000; document.body.classList.remove('print-blocked'); window.print();
}));
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = el('a'); anchor.href = url; anchor.download = filename;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download').addEventListener('click', () => action(async current => {
    const snapshot = labelSnapshot(current, values, sourceHash, Number($('dpi').value));
    downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `label-${current.id}-v${current.publicationRevision || 0}.json`);
}));
$('download-png').addEventListener('click', () => action(async current => {
    const version = generation, dpi = Number($('dpi').value);
    const blob = await renderLabelPng($('preview').querySelector('.label'), dpi, qrCode(current.id));
    await getAdminToken();
    if (version !== generation || !validate() || !authorized()) throw new Error('設定或登入狀態已變更，PNG 未下載，請重新確認');
    downloadBlob(blob, `label-${current.id}-v${current.publicationRevision || 0}-${dpi}dpi.png`);
}));
$('batch-select').addEventListener('change', () => select($('batch-select').value));
$('batch-search').addEventListener('input', () => filterOptions());
$('reload').addEventListener('click', reload);
$('reset').addEventListener('click', () => { if (record) { invalidate(); values = labelDefaults(record); fillFields(); render(); } });
for (const id of ['quantity', 'dpi']) $(id).addEventListener('input', () => { invalidate(); render(); });
for (const id of ['reviewed', 'calibrated']) $(id).addEventListener('change', validate);
new MutationObserver(() => { $('tool').inert = !authorized(); if (!authorized()) invalidate(); validate(); }).observe($('password-overlay'), { attributes: true, attributeFilter: ['style'] });
window.addEventListener('resize', validate);
window.addEventListener('beforeprint', () => { if (!authorized() || armedUntil < Date.now() || !validate()) document.body.classList.add('print-blocked'); });
window.addEventListener('afterprint', () => { armedUntil = 0; document.body.classList.add('print-blocked'); $('print-root').replaceChildren(); });
$('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    $('login-status').textContent = '登入中…';
    try {
        const response = await fetch('https://gsk-groq-proxy.gansingkim.workers.dev/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: $('password-input').value }), signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('Login failed');
        const result = await response.json();
        if (!result.success || typeof result.firebaseCustomToken !== 'string') throw new Error('Login failed');
        await login(result.firebaseCustomToken); $('login-status').textContent = '';
    } catch { $('login-status').textContent = '登入失敗或連線逾時，請確認密碼與網路後重試；密碼不會保留。'; }
    finally { $('password-input').value = ''; button.disabled = false; }
});
try { await mountAdminUI(reload); $('login-status').textContent = ''; } catch { $('login-status').textContent = '登入服務無法載入，請重新整理並檢查網路。'; }
render();
