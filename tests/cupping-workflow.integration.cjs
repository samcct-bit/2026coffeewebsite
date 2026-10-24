const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { initializeTestEnvironment, assertFails } = require('../scratch/security-runtime/node_modules/@firebase/rules-unit-testing');
const api = require('../scratch/security-runtime/node_modules/firebase/firestore');
let env, adminDb, publicDb, store, publication, model;
const now = Math.floor(Date.now() / 1000), claims = { coffeeAdmin: true, auth_time: now - 2, coffeeSessionExpiresAt: now + 3500 };
const review = { identityConfirmed: true, flavorReviewed: true, evidenceLimitationsAccepted: true, sensoryBasis: 'cupped', cuppingDate: '2026-10-20' };
const base = { beanName: '校準測試豆', roastDate: '2026-10-17', fcTime: '08:00', dropTime: '09:30', machine: '測試機', flavorTop: '原始文案', flavorMid: '原始文案', flavorBase: '原始文案' };
const words = { flavor: '柑橘、花香', mouthfeel: '滑順', aftertaste: '紅茶、回甘' };
before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-coffee-security', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
    adminDb = env.authenticatedContext('coffee-site-admin', claims).firestore(); publicDb = env.unauthenticatedContext().firestore();
    const { createPublicationService } = await import(pathToFileURL(path.resolve('js/publication_service.js')).href);
    const { createCuppingService } = await import(pathToFileURL(path.resolve('js/cupping_service.js')).href);
    model = await import(pathToFileURL(path.resolve('js/cupping_model.js')).href);
    publication = createPublicationService({ db: adminDb, api, authenticate: async () => 'coffee-site-admin' });
    store = createCuppingService({ db: adminDb, api, publicationStore: publication, authenticate: async () => 'coffee-site-admin' });
});
after(async () => { if (env) await env.cleanup(); });
async function seed(id) { await env.withSecurityRulesDisabled(ctx => api.setDoc(api.doc(ctx.firestore(), 'coffee_roasts', id), base)); return publication.read(id); }
function form(date = '2026-10-20') {
    const value = model.blankForm(date); Object.assign(value, { greenLot: 'LOT-01', grinder: '磨豆機', grindSetting: '20', waterSource: '同批水', referenceHidden: true, conditionsConfirmed: true });
    value.cups.forEach(cup => cup.rounds.forEach(round => Object.assign(round, { flavor: '柑橘、花香', mouthfeel: '滑順', aftertaste: '紅茶、回甘' }))); return value;
}
test('raw sessions are private; drafts save without publishing and incomplete lock is rejected', async () => {
    await seed('cupping-private'); const session = await store.save('cupping-private', store.newId(), model.blankForm('2026-10-20'));
    const ref = api.doc(publicDb, 'coffee_roast_drafts', session.batchId, 'cupping_sessions', session.id);
    await assertFails(api.getDoc(ref));
    const ordinary = env.authenticatedContext('ordinary', claims).firestore(); await assertFails(api.getDoc(api.doc(ordinary, ref.path)));
    const expired = env.authenticatedContext('coffee-site-admin', { ...claims, coffeeSessionExpiresAt: now - 1 }).firestore();
    await assertFails(api.getDoc(api.doc(expired, ref.path)));
    await assertFails(api.setDoc(api.doc(publicDb, 'coffee_roast_drafts', session.batchId, 'cupping_sessions', 'anonymous-write'), { batchId: session.batchId, form: session.form }));
    await assert.rejects(store.save(session.batchId, session.id, session.form, session.version, true), /請/);
    assert.equal((await api.getDoc(api.doc(publicDb, 'coffee_roasts', session.batchId))).data().flavorTop, '原始文案');
});
test('locked evidence cannot be overwritten/deleted, and stale editing cannot replace newer draft', async () => {
    await seed('cupping-lock'); const draft = await store.save('cupping-lock', store.newId(), form());
    const locked = await store.save(draft.batchId, draft.id, draft.form, draft.version, true);
    await assert.rejects(store.save(draft.batchId, draft.id, form(), draft.version), /其他分頁/);
    await assert.rejects(store.save(draft.batchId, draft.id, form(), locked.version), /鎖定/);
    const ref = api.doc(adminDb, 'coffee_roast_drafts', draft.batchId, 'cupping_sessions', draft.id);
    await assertFails(api.updateDoc(ref, { 'form.qualityNote': '覆寫證據' })); await assertFails(api.deleteDoc(ref));
});
test('adopt creates only private draft; publish checks evidence and excludes raw observations', async () => {
    const batch = await seed('cupping-publish'); const session = await store.save(batch.id, store.newId(), form(), null, true);
    let draft = await store.adopt(batch.id, [session.id], words, batch._workspace);
    assert.equal((await api.getDoc(api.doc(publicDb, 'coffee_roasts', batch.id))).data().flavorTop, '原始文案');
    draft = await publication.publish(batch.id, draft._workspace, review);
    const snapshot = (await api.getDoc(api.doc(publicDb, 'coffee_roasts', batch.id))).data();
    assert.equal(snapshot.sensoryProfile.method, 'solo'); assert.equal(snapshot.sensoryProfile.status, 'single');
    assert.equal(snapshot.flavorMid, '滑順'); assert.equal(snapshot.cuppingSessionIds, undefined); assert.equal(snapshot.form, undefined);
    assert.equal(snapshot.cuppingScore, 0); assert.equal(snapshot.sensoryProfile.qualityNote, undefined);
});
test('two different dates can yield solo repeat status; invented terms and wrong latest date are rejected', async () => {
    const batch = await seed('cupping-repeat');
    const a = await store.save(batch.id, store.newId(), form(), null, true), b = await store.save(batch.id, store.newId(), form('2026-10-22'), null, true);
    await assert.rejects(store.adopt(batch.id, [a.id, b.id], { ...words, mouthfeel: '奶油' }, batch._workspace), /未支持/);
    const draft = await store.adopt(batch.id, [a.id, b.id], words, batch._workspace);
    await assert.rejects(publication.publish(batch.id, draft._workspace, review), /日期/);
    await publication.publish(batch.id, draft._workspace, { ...review, cuppingDate: '2026-10-22' });
    assert.equal((await api.getDoc(api.doc(publicDb, 'coffee_roasts', batch.id))).data().sensoryProfile.status, 'repeated');
});
test('changed roast invalidates evidence; missing session cannot be used to assert cupping', async () => {
    const batch = await seed('cupping-stale'), session = await store.save(batch.id, store.newId(), form(), null, true);
    const updated = await publication.save(batch.id, { ...batch, dropTime: '10:10' }, batch._workspace);
    await assert.rejects(store.save(batch.id, store.newId(), form(), null, false, session.roastFingerprint), /批次資料已變更/);
    await assert.rejects(store.adopt(batch.id, [session.id], words, updated._workspace), /變更/);
    const forged = await publication.save(batch.id, { ...updated, sensoryProfile: { method: 'solo', status: 'single', dates: ['2026-10-20'], ...words },
        flavorTop: words.flavor, flavorMid: words.mouthfeel, flavorBase: words.aftertaste, cuppingSessionIds: ['missing-session-id'] }, updated._workspace);
    await assert.rejects(publication.publish(batch.id, forged._workspace, review), /不存在/);
});
