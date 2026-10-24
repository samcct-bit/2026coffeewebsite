import { getAdminToken, mountAdminUI } from './admin_auth.js';
import { publicationStore } from './publication_store.js';
import { cuppingStore } from './cupping_store.js';
import { blankForm, CATEGORIES, CATEGORY_NAMES, ROUNDS, developmentSeconds, profileCandidates, evidenceProblems, buildSensoryProfile, roastFingerprint } from './cupping_model.js';
const $ = id => document.getElementById(id);
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let batches = [], batch = null, sessions = [], current = null, form = blankForm(), words = {}, chosen = new Set(), busy = false, dirty = false, generation = 0;
const message = text => { $('cupping-message').textContent = text; };
function checkExit() { return !dirty || window.confirm('有未儲存的杯測觀察，確定離開目前表格？'); }
function field(label, value, type, update, disabled = false) {
    const wrapper = element('label', label), input = element(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type; else input.rows = 2;
    input.value = value; input.disabled = disabled;
    input.addEventListener('input', () => { update(type === 'number' && typeof value === 'number' ? Number(input.value) : input.value); dirty = true; });
    wrapper.append(input); return wrapper;
}
function checkbox(label, checked, update, disabled) {
    const wrapper = element('label'); wrapper.className = 'check'; const input = element('input'); input.type = 'checkbox'; input.checked = checked; input.disabled = disabled;
    input.addEventListener('change', () => { update(input.checked); dirty = true; }); wrapper.append(input, document.createTextNode(label)); return wrapper;
}
function renderForm() {
    const root = $('session-form'); root.replaceChildren();
    const locked = current?.status === 'locked', disabled = !batch || locked || busy;
    $('session-status').textContent = !batch ? '尚未選擇批次' : locked ? '已鎖定 · 不可覆寫' : '未完成 · 私有紀錄';
    $('save-session').disabled = $('lock-session').disabled = disabled;
    if (!batch) return;
    const grid = element('div'); grid.className = 'form-grid';
    for (const [key, caption, type] of [['date', '杯測日期', 'date'], ['greenLot', '生豆 lot／自訂可追溯批號', 'text'], ['grinder', '磨豆機', 'text'],
        ['grindSetting', '研磨刻度', 'text'], ['waterSource', '用水來源／配方', 'text'], ['doseG', '每杯實際豆量（g）', 'number'],
        ['vesselMl', '杯子實測滿杯容量（mL）', 'number'], ['waterTempC', '實際注水溫度（°C）', 'number']]) {
        const wrapper = field(caption, form[key], type, value => form[key] = value, disabled); wrapper.querySelector('input').dataset.formField = key;
        if (type === 'number') wrapper.querySelector('input').step = 'any'; grid.append(wrapper);
    }
    root.append(grid, checkbox('我已核對實際沖煮條件，預設 11g／200mL／93°C 不是自動量測結果', form.conditionsConfirmed, value => form.conditionsConfirmed = value, disabled),
        checkbox('填寫前未查看 AI 或供應商風味提示（仍屬單人實測，不宣稱完全盲測）', form.referenceHidden, value => form.referenceHidden = value, disabled));
    form.cups.forEach((cup, i) => {
        const details = element('details'); details.className = 'cup'; details.open = i === 0;
        details.append(element('summary', `杯 ${i + 1} · 獨立研磨與沖煮`));
        const rounds = element('div'); rounds.className = 'rounds';
        cup.rounds.forEach((round, j) => {
            const column = element('div'); column.className = 'round'; column.append(element('h3', ROUNDS[j]));
            for (const key of CATEGORIES) {
                const wrapper = field(CATEGORY_NAMES[key] + '（原始觀察，不限 13 字）', round[key], 'textarea', value => round[key] = value, disabled);
                const input = wrapper.querySelector('textarea'); input.dataset.cup = i; input.dataset.round = j; input.dataset.category = key;
                input.placeholder = '實際觀察用頓號分隔；未辨識可如實填寫'; column.append(wrapper);
            }
            column.append(field('品飲溫度（選填 °C）', round.temperature, 'number', value => round.temperature = value, disabled),
                field('餘韻持續時間（選填秒）', round.aftertasteSeconds, 'number', value => round.aftertasteSeconds = value, disabled)); rounds.append(column);
        });
        details.append(rounds, field('逐杯異常／不一致（不可因多數杯正常就忽略）', cup.concern, 'textarea', value => cup.concern = value, disabled)); root.append(details);
    });
    root.append(field('個人喜好或品質感受（與描述分開，不換算 SCA 分數）', form.qualityNote, 'textarea', value => form.qualityNote = value, disabled));
    $('reference-box').hidden = !locked; $('reference-box').open = false;
    $('reference-text').textContent = locked ? JSON.stringify(current.referenceSnapshot, null, 2) : '';
}
function renderSessions() {
    $('cupping-session').replaceChildren(); const empty = element('option', '建立新場次'); empty.value = ''; $('cupping-session').append(empty);
    for (const session of sessions) { const option = element('option', `${session.form.date}｜${session.status === 'locked' ? '已鎖定' : '未完成'}｜${session.id.slice(0, 8)}`); option.value = session.id; $('cupping-session').append(option); }
    $('cupping-session').value = current?.id || '';
    $('evidence-sessions').replaceChildren();
    for (const session of sessions.filter(s => s.status === 'locked')) {
        const label = element('label'); label.className = 'evidence-item'; const input = element('input'); input.type = 'checkbox'; input.checked = chosen.has(session.id); input.dataset.evidenceId = session.id;
        input.addEventListener('change', () => { input.checked ? chosen.add(session.id) : chosen.delete(session.id); words = {}; $('adoption-confirmed').checked = false; renderComparison(); });
        label.append(input, document.createTextNode(`${session.form.date} · ${session.form.greenLot} · ${session.id.slice(0, 8)}${session.form.cups.some(c => c.concern.trim()) ? ' · 有逐杯異常紀錄，採用前請查閱' : ''}${session.form.referenceHidden ? '' : ' · 未隱藏風味提示'}`)); $('evidence-sessions').append(label);
    }
}
async function renderComparison() {
    const version = ++generation, selected = sessions.filter(s => chosen.has(s.id));
    const root = $('profile-candidates'); root.replaceChildren(); $('adopt-profile').disabled = true;
    if (!batch || !selected.length) { root.append(element('p', '請勾選一或兩場已鎖定紀錄。')); return; }
    const errors = await evidenceProblems(batch, selected); if (version !== generation) return;
    if (errors.length) { root.append(element('p', errors.join('；'))); return; }
    const candidates = profileCandidates(selected);
    root.append(element('p', selected.length === 2 ? '單人複測：不同日期的共同重現詞，不代表多人共識。' : '本批單人實測：尚未跨日複測。'));
    for (const key of CATEGORIES) {
        const label = element('label', CATEGORY_NAMES[key] + '（最多 13 字，含頓號）'); const input = element('input'); input.type = 'text'; input.value = words[key] || ''; input.dataset.profileField = key;
        input.addEventListener('input', () => { words[key] = input.value; $('adoption-confirmed').checked = false; }); label.append(input); root.append(label);
        const chips = element('div'); chips.className = 'candidates';
        for (const term of candidates[key]) {
            const button = element('button', term); button.type = 'button';
            button.addEventListener('click', () => {
                const next = input.value ? input.value + '、' + term : term;
                if (Array.from(next).length > 13) { message('超過 13 字，請自行挑選較精簡的實測詞，不會自動截斷。'); return; }
                input.value = next; words[key] = next; $('adoption-confirmed').checked = false;
            }); chips.append(button);
        }
        if (!candidates[key].length) chips.append(element('p', '此類沒有足夠的相同重現詞，請保留不確定性或另場複測，不由 AI 補猜。')); root.append(chips);
    }
    $('adopt-profile').disabled = busy || CATEGORIES.some(key => !candidates[key].length);
}
async function chooseBatch(id) {
    const version = ++generation; batch = batches.find(item => item.id === id) || null; current = null; sessions = []; chosen.clear(); words = {}; form = blankForm(); dirty = false;
    renderForm(); renderSessions(); $('profile-candidates').replaceChildren(); $('return-review').hidden = true;
    $('roast-context').textContent = batch ? `${batch.beanName} · 烘焙 ${batch.roastDate} · 焙色未量測 · 發展秒數 ${developmentSeconds(batch) ?? '未知（缺少有效一爆／下豆時間）'}` : '請選擇批次；杯測紀錄只供管理員查閱。';
    if (!batch) return;
    const result = await cuppingStore.list(batch.id); if (version !== generation) return;
    sessions = result; renderSessions(); renderComparison();
}
async function refresh() {
    if (!checkExit()) return;
    const selectedId = batch?.id || new URL(location.href).searchParams.get('id') || '';
    const data = await publicationStore.list(); batches = data;
    $('cupping-batch').replaceChildren(); const empty = element('option', '請選擇烘焙批次'); empty.value = ''; $('cupping-batch').append(empty);
    for (const item of batches) { const option = element('option', `${item.roastDate}｜${item.beanName}`); option.value = item.id; $('cupping-batch').append(option); }
    $('cupping-batch').value = batches.some(item => item.id === selectedId) ? selectedId : ''; await chooseBatch($('cupping-batch').value);
    if (selectedId && !batch) message('指定批次不存在，沒有自動改選其他豆款。');
}
async function run(operation) {
    if (busy) return;
    busy = true; message('處理中…');
    $('cupping-tool').querySelectorAll('button,input,select,textarea').forEach(node => node.disabled = true);
    try { await getAdminToken(); await operation(); }
    catch (error) { message(error.message || '操作失敗，請保留表格並重新確認'); }
    finally { busy = false; $('cupping-tool').querySelectorAll('button,input,select,textarea').forEach(node => node.disabled = false); renderForm(); renderSessions(); renderComparison(); }
}
async function save(locking) {
    if (!batch) throw new Error('請先選擇批次');
    if (locking && !window.confirm('完成並鎖定三杯三輪原始觀察？鎖定後不可覆寫；需要修正請另建場次。')) { message('已取消，表格保留。'); return; }
    const result = await cuppingStore.save(batch.id, current?.id || cuppingStore.newId(), form, current?.version || null, locking, await roastFingerprint(batch));
    current = result; form = JSON.parse(JSON.stringify(result.form)); dirty = false;
    sessions = [result, ...sessions.filter(s => s.id !== result.id)]; message(locking ? '原始觀察已鎖定，可勾選場次建立描述草稿；公開頁面未更動。' : '未完成紀錄已儲存，公開頁面未更動。');
}
$('save-session').addEventListener('click', () => run(() => save(false)));
$('lock-session').addEventListener('click', () => run(() => save(true)));
$('adopt-profile').addEventListener('click', () => run(async () => {
    if (!$('adoption-confirmed').checked) throw new Error('請先核對逐杯異常與描述採用確認');
    const selected = sessions.filter(s => chosen.has(s.id)); await buildSensoryProfile(batch, selected, words);
    if (!window.confirm('採用將更新待審核草稿的風味／口感／餘韻，不直接發布；原有故事仍須人工核對。確定繼續？')) return;
    const saved = await cuppingStore.adopt(batch.id, selected.map(s => s.id), words, batch._workspace);
    batch = saved; batches = batches.map(item => item.id === saved.id ? saved : item);
    $('return-review').href = './roast_db.html?id=' + encodeURIComponent(batch.id); $('return-review').hidden = false;
    message('已採用為私有草稿，公開網站未更動。請回後台審核發布；單人描述不產生 SCA 分數。');
}));
$('cupping-batch').addEventListener('change', () => { if (!checkExit()) { $('cupping-batch').value = batch?.id || ''; return; } run(() => chooseBatch($('cupping-batch').value)); });
$('cupping-session').addEventListener('change', () => {
    if (!checkExit()) { $('cupping-session').value = current?.id || ''; return; }
    current = sessions.find(s => s.id === $('cupping-session').value) || null; form = current ? JSON.parse(JSON.stringify(current.form)) : blankForm(); dirty = false; renderForm();
});
$('new-session').addEventListener('click', () => { if (!checkExit()) return; current = null; form = blankForm(); dirty = false; $('cupping-session').value = ''; renderForm(); });
$('refresh-cupping').addEventListener('click', () => run(refresh));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
new MutationObserver(() => { const allowed = $('password-overlay').style.display === 'none'; $('cupping-tool').inert = !allowed; if (!allowed) message('登入已到期，請重新登入；尚未儲存的表格仍保留。'); }).observe($('password-overlay'), { attributes: true, attributeFilter: ['style'] });
$('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try { if (!await window.GansingKimAI.verifyPasswordSecure($('password-input').value)) throw new Error('登入失敗'); $('login-message').textContent = ''; }
    catch { $('login-message').textContent = '登入失敗，請確認密碼與網路後重試。'; }
    finally { $('password-input').value = ''; button.disabled = false; }
});
try { await mountAdminUI(() => run(refresh)); $('login-message').textContent = ''; } catch { $('login-message').textContent = '登入服務無法載入，請重新整理。'; }
