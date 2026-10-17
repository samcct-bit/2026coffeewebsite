const { test, before, after } = require('node:test');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('../scratch/security-runtime/node_modules/@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, updateDoc } = require('../scratch/security-runtime/node_modules/firebase/firestore');

let env;
const projectId = 'demo-coffee-security';
const now = Math.floor(Date.now() / 1000);
const roast = { beanName: '權限測試豆', roastDate: '2026-10-17', flavor: '柑橘、可可' };
const adminClaims = { coffeeAdmin: true, auth_time: now - 10, coffeeSessionExpiresAt: now + 3500 };
const coffee = db => doc(db, 'coffee_roasts/rules-test');
before(async () => {
    // 強制指定離線 emulator；此測試不連正式專案。
    env = await initializeTestEnvironment({ projectId,
        firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') } });
    await env.withSecurityRulesDisabled(async ctx => {
        await setDoc(coffee(ctx.firestore()), roast);
        await setDoc(doc(ctx.firestore(), 'summer_homework_2026/rules-test'), { value: 'existing' });
    });
});
after(async () => { if (env) await env.cleanup(); });

test('公開豆單允許匿名讀取', async () => {
    await assertSucceeds(getDoc(coffee(env.unauthenticatedContext().firestore())));
});
test('匿名不得新增、修改或刪除', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'coffee_roasts/anonymous-create'), roast));
    await assertFails(updateDoc(coffee(db), { flavor: '未授權內容' }));
    await assertFails(deleteDoc(coffee(db)));
});
test('一般登入使用者與僅有管理員角色但 UID 不符者均不得寫入', async () => {
    for (const claims of [{}, adminClaims]) {
        await assertFails(setDoc(coffee(env.authenticatedContext('ordinary-user', claims).firestore()), roast));
    }
});
test('管理員缺少角色、期限過期、期限偽長或登入時間在未來均拒絕', async () => {
    for (const claims of [
        {}, { ...adminClaims, coffeeAdmin: false },
        { ...adminClaims, coffeeSessionExpiresAt: now - 1 },
        { ...adminClaims, coffeeSessionExpiresAt: now + 7200 },
        { ...adminClaims, auth_time: now + 60 },
        { ...adminClaims, coffeeSessionExpiresAt: '9999999999' },
    ]) {
        await assertFails(setDoc(coffee(env.authenticatedContext('coffee-site-admin', claims).firestore()), roast));
    }
});
test('合法管理員可新增、修改、刪除專用測試文件', async () => {
    const db = env.authenticatedContext('coffee-site-admin', adminClaims).firestore();
    const ref = doc(db, 'coffee_roasts/admin-lifecycle');
    await assertSucceeds(setDoc(ref, roast));
    await assertSucceeds(updateDoc(ref, { flavor: '可可、焦糖' }));
    await assertSucceeds(deleteDoc(ref));
});
test('管理員仍須提供有效名稱、日期與合理欄位數', async () => {
    const db = env.authenticatedContext('coffee-site-admin', adminClaims).firestore();
    for (const data of [
        { roastDate: '2026-10-17' }, { ...roast, beanName: '' },
        { ...roast, beanName: '豆'.repeat(241) }, { ...roast, beanName: 123 },
        { ...roast, roastDate: 'not-a-date' }, { ...roast, roastDate: 20261017 },
        { ...roast, ...Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`field${i}`, i])) },
    ]) await assertFails(setDoc(coffee(db), data));
});
test('其他集合預設拒絕咖啡管理員存取', async () => {
    const db = env.authenticatedContext('coffee-site-admin', adminClaims).firestore();
    await assertFails(getDoc(doc(db, 'unrelated/rules-test')));
    await assertFails(setDoc(doc(db, 'unrelated/rules-test'), { value: true }));
});
test('教學集合維持指定 email 只讀，咖啡管理員不得讀取', async () => {
    const ref = db => doc(db, 'summer_homework_2026/rules-test');
    await assertFails(getDoc(ref(env.unauthenticatedContext().firestore())));
    await assertFails(getDoc(ref(env.authenticatedContext('coffee-site-admin', adminClaims).firestore())));
    const teacher = env.authenticatedContext('teacher', { email: 'samcct@gmail.com' }).firestore();
    await assertSucceeds(getDoc(ref(teacher)));
    await assertFails(setDoc(ref(teacher), { value: 'changed' }));
    await assertFails(deleteDoc(ref(teacher)));
});
