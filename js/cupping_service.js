import { workspaceRecord } from './publication_model.js';
import { roastFingerprint, roastIdentity, formProblems, buildSensoryProfile } from './cupping_model.js';

export function createCuppingService({ db, api, authenticate, publicationStore, uuid = () => crypto.randomUUID() }) {
    const { doc, collection, getDoc, getDocs, runTransaction, serverTimestamp } = api;
    function checked(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('紀錄 ID 不正確'); return id; }
    const sessionRef = (batch, id) => doc(db, 'coffee_roast_drafts', checked(batch), 'cupping_sessions', checked(id));
    async function list(batch) {
        await authenticate();
        const result = await getDocs(collection(db, 'coffee_roast_drafts', checked(batch), 'cupping_sessions'));
        return result.docs.map(item => ({ ...item.data(), id: item.id })).sort((a, b) => b.form.date.localeCompare(a.form.date));
    }
    async function save(batch, id, form, expectedVersion = null, locking = false, expectedRoastFingerprint = null) {
        const actor = await authenticate(), payload = JSON.parse(JSON.stringify(form));
        await runTransaction(db, async tx => {
            const [pub, draft, previous] = await Promise.all([tx.get(doc(db, 'coffee_roasts', checked(batch))),
                tx.get(doc(db, 'coffee_roast_drafts', batch)), tx.get(sessionRef(batch, id))]);
            if (!pub.exists() && !draft.exists()) throw new Error('批次已不存在，請回後台確認');
            const record = workspaceRecord(batch, pub.exists() ? pub.data() : null, draft.exists() ? draft.data() : null);
            const problems = formProblems(payload, record.roastDate, locking);
            if (problems.length) throw new Error(problems.join('；'));
            const old = previous.exists() ? previous.data() : null;
            if ((old?.version || null) !== expectedVersion) throw new Error('杯測已由其他分頁更新，請重新載入');
            if (old?.status === 'locked') throw new Error('原始紀錄已鎖定，請另建新場次，不覆寫實測證據');
            const signature = await roastFingerprint(record);
            if (expectedRoastFingerprint && signature !== expectedRoastFingerprint) throw new Error('批次資料已變更，請重新載入並確認正在品飲的批次');
            if (old && old.roastFingerprint !== signature) throw new Error('烘焙資料已變更，請另建場次；舊紀錄保留');
            tx.set(sessionRef(batch, id), { batchId: batch, form: payload, method: 'solo', roastColor: 'unmeasured',
                roastFingerprint: signature, roastSnapshot: old?.roastSnapshot || roastIdentity(record),
                referenceSnapshot: old?.referenceSnapshot || { flavorTop: record.flavorTop || '', flavorMid: record.flavorMid || '', flavorBase: record.flavorBase || '' },
                status: locking ? 'locked' : 'draft', version: uuid(), createdAt: old?.createdAt || serverTimestamp(),
                updatedAt: serverTimestamp(), updatedBy: actor, lockedAt: locking ? serverTimestamp() : null });
        });
        const snapshot = await getDoc(sessionRef(batch, id)); return { ...snapshot.data(), id };
    }
    async function adopt(batch, ids, words, expectedWorkspace) {
        await authenticate();
        const record = await publicationStore.read(batch);
        if (!record) throw new Error('找不到批次');
        const sessions = await Promise.all(ids.map(async id => { const snapshot = await getDoc(sessionRef(batch, id)); if (!snapshot.exists()) throw new Error('杯測不存在'); return { ...snapshot.data(), id }; }));
        const profile = await buildSensoryProfile(record, sessions, words);
        return publicationStore.save(batch, { ...record, sensoryProfile: profile, cuppingSessionIds: [...ids],
            flavorTop: profile.flavor, flavorMid: profile.mouthfeel, flavorBase: profile.aftertaste, cuppingScore: 0 }, expectedWorkspace, 'cupping');
    }
    return { list, save, adopt, newId: () => uuid() };
}
