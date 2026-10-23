import { publicationProblems, normalizeFlavor } from './publication_model.js';

const FIELDS = [
    ['beanName', '豆名'], ['origin', '產區'], ['process', '處理法'], ['variety', '品種'],
    ['roastLevel', '焙度'], ['roastDate', '烘焙日'], ['flavorTop', '初韻'], ['flavorMid', '中調'],
    ['flavorBase', '尾韻'], ['storyCopy', '故事文案'], ['brewTemp', '沖煮水溫'], ['brewMethod', '沖煮方式'],
    ['cuppingScore', '人工杯測分數']
];
function element(tag, text, className = '') {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    node.className = className;
    return node;
}
export function renderPublicationPanel(container, record, { store, changed, edit }) {
    if (!container) return;
    container.replaceChildren();
    const context = record._workspace;
    if (!context) return;
    container.append(element('h3', '草稿審核與發布', 'text-lg font-bold text-brass-gold mb-2'));
    container.append(element('p', context.hasDraft
        ? (context.publishedExists ? '有待審核草稿。公開網站仍顯示上一個已發布版本。' : '尚未發布，只有管理員能看見這筆草稿。')
        : '目前沒有待發布草稿。編輯或 AI 再分析後，會先另存草稿。',
    'text-sm text-gray-300 mb-3'));
    container.append(element('p', '風味字數上限 13 字（含頓號）。AI 推測不等於本批實測杯測。',
        'text-xs text-gray-400 mb-3'));
    const overflow = element('div', undefined, 'overflow-x-auto');
    const table = element('table', undefined, 'w-full text-xs border-collapse');
    table.style.minWidth = '520px';
    const header = element('tr');
    for (const title of ['欄位', '目前公開版', context.hasDraft ? '待發布草稿' : '管理紀錄']) header.append(element('th', title, 'p-2 text-left border-b border-white/10'));
    table.append(header);
    for (const [field, label] of FIELDS) {
        const published = context.published?.[field];
        const value = record[field];
        if (!value && !published && !field.startsWith('flavor')) continue;
        const row = element('tr');
        const changedValue = String(published ?? '') !== String(value ?? '');
        let description = label;
        if (field.startsWith('flavor')) description += ' (' + Array.from(normalizeFlavor(value)).length + '/13)';
        row.append(element('th', description, 'p-2 text-left align-top border-b border-white/5'));
        for (const text of [context.publishedExists ? String(published ?? '未提供') : '尚未發布', String(value ?? '未提供')]) {
            const cell = element('td', undefined, 'p-2 align-top border-b border-white/5');
            const content = element('div', text);
            content.style.cssText = 'white-space:pre-wrap;max-height:150px;overflow:auto;overflow-wrap:anywhere;';
            if (changedValue && context.hasDraft) cell.classList.add('text-amber-200');
            cell.append(content); row.append(cell);
        }
        table.append(row);
    }
    overflow.append(table); container.append(overflow);
    if (record.aiRorDiagnosis && context.hasDraft) {
        const details = element('details', undefined, 'my-3 text-xs text-gray-300');
        details.append(element('summary', 'AI 曲線觀察與待驗證假設（僅管理員可見）'));
        const text = element('pre', JSON.stringify(record.aiRorDiagnosis, null, 2), 'whitespace-pre-wrap mt-2');
        text.style.overflowWrap = 'anywhere';
        details.append(text); container.append(details);
    }
    if (record.aiGenerationWarning && context.hasDraft) container.append(element('p', record.aiGenerationWarning, 'my-3 text-sm text-amber-200'));
    if (Array.isArray(record.referenceConflicts) && record.referenceConflicts.length && context.hasDraft) {
        container.append(element('p', '來源提醒：' + record.referenceConflicts.join('；'), 'my-3 text-xs text-amber-200'));
    }
    const problems = publicationProblems(record);
    if (context.hasDraft && problems.length) container.append(element('p', problems.join('；'), 'my-3 text-sm text-red-300'));
    const review = {};
    const form = element('div', undefined, 'space-y-2 my-4 text-sm text-gray-200');
    for (const [key, label] of [
        ['identityConfirmed', '我已核對豆款、品種、處理法與本批日期'],
        ['flavorReviewed', '我已逐項審閱風味與公開文案，確認沒有未查證的保證語句'],
        ['evidenceLimitationsAccepted', '我了解 AI 與 ROR 僅提供參考，未杯測內容會標示為待杯測']
    ]) {
        const wrapper = element('label', undefined, 'flex gap-2 items-start');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.dataset.reviewField = key; input.disabled = !context.hasDraft;
        review[key] = input;
        wrapper.append(input, document.createTextNode(label)); form.append(wrapper);
    }
    const basis = document.createElement('select');
    basis.dataset.reviewBasis = 'true';
    basis.className = 'bg-black/70 border border-white/20 rounded p-2';
    for (const [value, label] of [['reference', '風味參考・待杯測'], ['cupped', '本批杯測確認（需日期）']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; basis.append(option);
    }
    basis.disabled = !context.hasDraft;
    const date = document.createElement('input');
    date.type = 'date'; date.disabled = true; date.dataset.cuppingDate = 'true';
    date.className = 'bg-black/70 border border-white/20 rounded p-2 ml-2';
    date.setAttribute('aria-label', '本批杯測日期');
    basis.addEventListener('change', () => { date.disabled = basis.value !== 'cupped'; });
    form.append(basis, date); container.append(form);
    const message = element('p', '', 'text-sm text-amber-200 my-2');
    message.setAttribute('role', 'status'); container.append(message);
    const actions = element('div', undefined, 'flex flex-wrap gap-2');
    let busy = false;
    function button(label, action, disabled = false) {
        const node = element('button', label, 'px-3 py-2 rounded border border-brass-gold/40 text-sm text-brass-gold disabled:opacity-40');
        node.type = 'button'; node.disabled = disabled;
        node.addEventListener('click', async () => {
            if (busy) return;
            busy = true; node.disabled = true; message.textContent = '';
            try { await action(); } catch (error) { message.textContent = error.message || '操作失敗，原資料已保留'; }
            finally { busy = false; if (node.isConnected) node.disabled = disabled; }
        });
        actions.append(node);
    }
    button('編輯草稿', () => edit(record.id));
    button('審核並發布', async () => {
        const checks = Object.fromEntries(Object.entries(review).map(([key, input]) => [key, input.checked]));
        checks.sensoryBasis = basis.value; checks.cuppingDate = date.value;
        const errors = publicationProblems(record, checks);
        if (errors.length) throw new Error(errors.join('；'));
        if (!window.confirm('確認發布「' + record.beanName + '」？公開網站將更新為此草稿內容。')) return;
        const result = await store.publish(record.id, context, checks);
        await changed(result, '發布完成，公開網站現在顯示新版本。');
    }, !context.hasDraft || problems.length > 0);
    button('捨棄草稿', async () => {
        if (!window.confirm('確認捨棄草稿？已發布內容不會更動；尚未發布的紀錄會被移除。')) return;
        await changed(await store.discard(record.id, context), '草稿已捨棄，公開版本保持不變。');
    }, !context.hasDraft);
    button('還原上一版為草稿', async () => {
        if (context.hasDraft && !window.confirm('這會以還原內容取代目前草稿，確定繼續？')) return;
        await changed(await store.restorePrevious(record.id, context), '上一版已另存草稿，確認後才會重新發布。');
    }, !context.publishedExists);
    if (context.publishedExists) {
        const link = element('a', '檢視公開版', 'px-3 py-2 text-sm underline text-gray-200');
        link.href = './bean.html?id=' + encodeURIComponent(record.id);
        link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
        const labelLink = element('a', '製作此批標籤', 'px-3 py-2 text-sm underline text-gray-200');
        labelLink.href = './label.html?id=' + encodeURIComponent(record.id);
        labelLink.target = '_blank'; labelLink.rel = 'noopener noreferrer'; actions.append(labelLink);
    }
    container.append(actions);
}
