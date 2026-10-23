import { preparePayload, buildPublicSnapshot, publishedRevision, workspaceRecord } from './publication_model.js';

// SDK dependencies are injected so emulator tests exercise the same transactions as the browser.
export function createPublicationService({ db, api, authenticate, uuid = () => crypto.randomUUID() }) {
    const { doc, collection, getDoc, getDocs, runTransaction, serverTimestamp, query, orderBy, limit } = api;
    const pubRef = id => doc(db, 'coffee_roasts', checkedId(id));
    const draftRef = id => doc(db, 'coffee_roast_drafts', checkedId(id));
    function checkedId(id) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('批次 ID 格式不正確');
        return id;
    }
    const data = snapshot => snapshot.exists() ? snapshot.data() : null;
    function checkVersion(published, draft, expected) {
        if (!expected || (draft?.draftVersion || null) !== expected.version ||
            !!published !== expected.publishedExists || publishedRevision(published) !== expected.publishedRevision) {
            throw new Error('資料已由其他分頁更新，請重新載入後再操作，避免覆寫新版本');
        }
    }
    async function read(id) {
        await authenticate();
        const [published, draft] = await Promise.all([getDoc(pubRef(id)), getDoc(draftRef(id))]);
        if (!published.exists() && !draft.exists()) return null;
        return workspaceRecord(id, data(published), data(draft));
    }
    async function list() {
        await authenticate();
        const [published, drafts] = await Promise.all([getDocs(collection(db, 'coffee_roasts')), getDocs(collection(db, 'coffee_roast_drafts'))]);
        const records = new Map();
        published.forEach(snapshot => records.set(snapshot.id, { published: snapshot.data() }));
        drafts.forEach(snapshot => records.set(snapshot.id, { ...records.get(snapshot.id), draft: snapshot.data() }));
        return Array.from(records, ([id, item]) => workspaceRecord(id, item.published, item.draft))
            .sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')));
    }
    async function save(id, record, expected, source = 'manual') {
        const actor = await authenticate();
        const payload = preparePayload(record);
        if (!payload.beanName || !payload.roastDate) throw new Error('草稿需要豆名與烘焙日期');
        await runTransaction(db, async tx => {
            const [publishedSnapshot, draftSnapshot] = await Promise.all([tx.get(pubRef(id)), tx.get(draftRef(id))]);
            const published = data(publishedSnapshot), draft = data(draftSnapshot);
            checkVersion(published, draft, expected);
            tx.set(draftRef(id), {
                payload, publishedPayload: draft?.publishedPayload || (published ? preparePayload(published) : {}),
                status: 'draft', source, draftVersion: uuid(),
                basePublishedRevision: draft?.status === 'draft' ? draft.basePublishedRevision : publishedRevision(published),
                updatedAt: serverTimestamp(), updatedBy: actor
            });
        });
        return read(id);
    }
    async function publish(id, expected, review) {
        const actor = await authenticate();
        await runTransaction(db, async tx => {
            const [publishedSnapshot, draftSnapshot] = await Promise.all([tx.get(pubRef(id)), tx.get(draftRef(id))]);
            const published = data(publishedSnapshot), draft = data(draftSnapshot);
            checkVersion(published, draft, expected);
            if (!draft || draft.status !== 'draft') throw new Error('沒有待發布草稿');
            if (draft.basePublishedRevision !== publishedRevision(published)) throw new Error('公開版本已變更，請重新載入並比對草稿');
            const revision = publishedRevision(published) + 1;
            const snapshot = buildPublicSnapshot(draft.payload, review, {
                id, publicationRevision: revision, publishedAt: serverTimestamp(), publishedBy: actor, sourceDraftVersion: draft.draftVersion
            });
            if (published) tx.set(doc(db, 'coffee_publication_history', id, 'versions', uuid()), {
                record: published, publicationRevision: publishedRevision(published), archivedAt: serverTimestamp(), archivedBy: actor
            });
            tx.set(pubRef(id), snapshot);
            tx.set(draftRef(id), { ...draft, status: 'published', payload: draft.payload, publishedPayload: draft.payload,
                draftVersion: uuid(), basePublishedRevision: revision, lastPublishedVersion: draft.draftVersion,
                review: snapshot.publicationReview, updatedAt: serverTimestamp(), updatedBy: actor });
        });
        return read(id);
    }
    async function discard(id, expected) {
        const actor = await authenticate();
        await runTransaction(db, async tx => {
            const [publishedSnapshot, draftSnapshot] = await Promise.all([tx.get(pubRef(id)), tx.get(draftRef(id))]);
            const published = data(publishedSnapshot), draft = data(draftSnapshot);
            checkVersion(published, draft, expected);
            if (!draft || draft.status !== 'draft') throw new Error('沒有待捨棄的草稿');
            if (!published) tx.delete(draftRef(id));
            else tx.set(draftRef(id), { ...draft, status: 'published', payload: draft.publishedPayload || preparePayload(published),
                draftVersion: uuid(), basePublishedRevision: publishedRevision(published), updatedAt: serverTimestamp(), updatedBy: actor });
        });
        return read(id);
    }
    async function restorePrevious(id, expected) {
        await authenticate();
        const versions = await getDocs(query(collection(db, 'coffee_publication_history', checkedId(id), 'versions'), orderBy('archivedAt', 'desc'), limit(1)));
        if (versions.empty) throw new Error('還沒有可還原的上一版');
        return save(id, versions.docs[0].data().record, expected, 'restore');
    }
    async function remove(id, expected) {
        const actor = await authenticate();
        await runTransaction(db, async tx => {
            const [publishedSnapshot, draftSnapshot] = await Promise.all([tx.get(pubRef(id)), tx.get(draftRef(id))]);
            checkVersion(data(publishedSnapshot), data(draftSnapshot), expected);
            if (publishedSnapshot.exists()) tx.set(doc(db, 'coffee_publication_history', id, 'versions', uuid()), {
                record: publishedSnapshot.data(), publicationRevision: publishedRevision(publishedSnapshot.data()),
                archivedAt: serverTimestamp(), archivedBy: actor
            });
            tx.delete(pubRef(id));
            if (draftSnapshot.exists()) tx.delete(draftRef(id));
        });
    }
    return { read, list, save, publish, discard, restorePrevious, remove,
        newContext: () => ({ version: null, publishedExists: false, publishedRevision: 0 }) };
}
