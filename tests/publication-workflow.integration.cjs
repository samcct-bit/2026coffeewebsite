const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('../scratch/security-runtime/node_modules/@firebase/rules-unit-testing');
const api = require('../scratch/security-runtime/node_modules/firebase/firestore');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp } = api;
let env, service, publicDb, adminDb;
const now = Math.floor(Date.now() / 1000);
const claims = { coffeeAdmin: true, auth_time: now - 5, coffeeSessionExpiresAt: now + 3500 };
const review = { identityConfirmed: true, flavorReviewed: true, evidenceLimitationsAccepted: true, sensoryBasis: 'reference' };
const roast = { beanName: '測試莊園', roastDate: '2026-10-17', flavorTop: '茉莉、柑橘', flavorMid: '蜂蜜、莓果',
    flavorBase: '可可、回甘', storyCopy: '人工整理的已發布故事', cuppingScore: 86, supplierCuppingNotes: '私人筆記',
    aiRorDiagnosis: { notes: '內部 AI 推測' }, referenceConflicts: ['私人來源衝突'] };
before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-coffee-security',
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
    adminDb = env.authenticatedContext('coffee-site-admin', claims).firestore();
    publicDb = env.unauthenticatedContext().firestore();
    const { createPublicationService } = await import(pathToFileURL(path.resolve('js/publication_service.js')).href);
    service = createPublicationService({ db: adminDb, api, authenticate: async () => 'coffee-site-admin' });
});
after(async () => { if (env) await env.cleanup(); });
async function seed(id) {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'coffee_roasts', id), roast));
    return service.read(id);
}
test('AI 草稿不改公開版，只有管理員能讀取草稿', async () => {
    const old = await seed('flow-ai');
    const draft = await service.save(old.id, { ...old, flavorTop: '新 AI 草稿', storyCopy: '未審核內容' }, old._workspace, 'ai');
    assert.equal(draft._workspace.hasDraft, true);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', old.id))).data().flavorTop, roast.flavorTop);
    await assertFails(getDoc(doc(publicDb, 'coffee_roast_drafts', old.id)));
    await assertFails(getDocs(collection(publicDb, 'coffee_roast_drafts')));
    const ordinary = env.authenticatedContext('ordinary-user', claims).firestore();
    await assertFails(getDoc(doc(ordinary, 'coffee_roast_drafts', old.id)));
});
test('新烘焙只存私有草稿，不會因知道 ID 而公開', async () => {
    const draft = await service.save('flow-new', roast, service.newContext(), 'roast');
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', 'flow-new'))).exists(), false);
    assert.equal(draft.flavorMid, roast.flavorMid);
});
test('缺少審核或超過含頓號 13 字時不能發布', async () => {
    const draft = await service.read('flow-new');
    await assert.rejects(service.publish(draft.id, draft._workspace, { ...review, flavorReviewed: false }), /人工審核/);
    const long = await service.save(draft.id, { ...draft, flavorTop: '一二三四五六七八九十十一二三四' }, draft._workspace, 'manual');
    await assert.rejects(service.publish(long.id, long._workspace, review), /13 字/);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).exists(), false);
});
test('審核發布是交易，公開快照移除內部資料並保留上一版', async () => {
    const draft = await service.read('flow-ai');
    const published = await service.publish(draft.id, draft._workspace, review);
    assert.equal(published._workspace.hasDraft, false);
    const snapshot = (await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).data();
    assert.equal(snapshot.publicationRevision, 1);
    assert.equal(snapshot.flavorTop, '新AI草稿');
    assert.equal(snapshot.cuppingScore, 0);
    assert.equal(snapshot.supplierCuppingNotes, undefined);
    assert.equal(snapshot.aiRorDiagnosis, undefined);
    assert.equal(snapshot.referenceConflicts, undefined);
    const history = await getDocs(collection(adminDb, 'coffee_publication_history', draft.id, 'versions'));
    assert.equal(history.size, 1);
    assert.equal(history.docs[0].data().record.flavorTop, roast.flavorTop);
    await assertFails(getDoc(doc(publicDb, history.docs[0].ref.path)));
    await assertFails(updateDoc(history.docs[0].ref, { publicationRevision: 99 }));
});
test('過期分頁不能覆寫草稿、發布或捨棄新版本', async () => {
    const a = await service.read('flow-ai');
    const b = await service.read('flow-ai');
    const fresh = await service.save(a.id, { ...a, flavorMid: '人工修訂' }, a._workspace, 'manual');
    await assert.rejects(service.save(b.id, { ...b, flavorMid: '過期內容' }, b._workspace, 'ai'), /其他分頁/);
    await assert.rejects(service.publish(b.id, b._workspace, review), /其他分頁/);
    await assert.rejects(service.discard(b.id, b._workspace), /其他分頁/);
    assert.equal((await service.read(a.id)).flavorMid, fresh.flavorMid);
});
test('發表後還原上一版只產生草稿，捨棄不影響公開版', async () => {
    let current = await service.read('flow-ai');
    current = await service.publish(current.id, current._workspace, review);
    assert.equal(current._workspace.publishedRevision, 2);
    const restored = await service.restorePrevious(current.id, current._workspace);
    assert.equal(restored._workspace.hasDraft, true);
    assert.equal(restored.flavorMid, roast.flavorMid);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', current.id))).data().flavorMid, '人工修訂');
    const discarded = await service.discard(restored.id, restored._workspace);
    assert.equal(discarded._workspace.hasDraft, false);
    assert.equal(discarded.flavorMid, '人工修訂');
});
test('繞過發布交易直接修改公開文件會被規則拒絕', async () => {
    const ref = doc(adminDb, 'coffee_roasts', 'flow-ai');
    const current = (await getDoc(ref)).data();
    await assertFails(updateDoc(ref, { flavorTop: '直接覆寫' }));
    await assertFails(setDoc(ref, { ...current, publicationRevision: 3, publishedAt: serverTimestamp() }));
    const expired = env.authenticatedContext('coffee-site-admin', { ...claims, coffeeSessionExpiresAt: now - 1 }).firestore();
    await assertFails(getDoc(doc(expired, 'coffee_roast_drafts', 'flow-ai')));
});
test('未發布草稿可捨棄，不殘留公開紀錄', async () => {
    const draft = await service.save('flow-discard', roast, service.newContext(), 'manual');
    assert.equal(await service.discard(draft.id, draft._workspace), null);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).exists(), false);
});
test('已杯測標示必須有日期，管理員刪除仍可清理自己的測試資料', async () => {
    let draft = await service.save('flow-cupped', roast, service.newContext(), 'manual');
    await assert.rejects(service.publish(draft.id, draft._workspace, { ...review, sensoryBasis: 'cupped' }), /杯測日期/);
    draft = await service.publish(draft.id, draft._workspace, { ...review, sensoryBasis: 'cupped', cuppingDate: '2026-10-17' });
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).data().cuppingScore, 86);
    await service.remove(draft.id, draft._workspace);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).exists(), false);
});
test('13 字包含全型頓號可發布，第 14 字不能發布', async () => {
    const exact = '一二三四五六、七八九十甲乙';
    assert.equal(Array.from(exact).length, 13);
    let draft = await service.save('flow-limit', { ...roast, flavorTop: exact }, service.newContext(), 'manual');
    draft = await service.publish(draft.id, draft._workspace, review);
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).data().flavorTop, exact);
    draft = await service.save(draft.id, { ...draft, flavorTop: exact + '丙' }, draft._workspace, 'manual');
    await assert.rejects(service.publish(draft.id, draft._workspace, review), /13 字/);
});
test('即使手動組交易，也不能發布與已審草稿不同的風味', async () => {
    const draft = await service.save('flow-forged', roast, service.newContext(), 'manual');
    const { buildPublicSnapshot } = await import(pathToFileURL(path.resolve('js/publication_model.js')).href);
    const snapshot = buildPublicSnapshot(draft, review, { id: draft.id, publicationRevision: 1, publishedAt: serverTimestamp(),
        publishedBy: 'coffee-site-admin', sourceDraftVersion: draft._workspace.version });
    snapshot.flavorTop = '未審核替換';
    const batch = api.writeBatch(adminDb);
    batch.set(doc(adminDb, 'coffee_roasts', draft.id), snapshot);
    batch.update(doc(adminDb, 'coffee_roast_drafts', draft.id), {
        status: 'published', lastPublishedVersion: draft._workspace.version, basePublishedRevision: 1,
        review: snapshot.publicationReview, updatedAt: serverTimestamp(), updatedBy: 'coffee-site-admin'
    });
    await assertFails(batch.commit());
    assert.equal((await getDoc(doc(publicDb, 'coffee_roasts', draft.id))).exists(), false);
    assert.equal((await service.read(draft.id))._workspace.hasDraft, true);
});
