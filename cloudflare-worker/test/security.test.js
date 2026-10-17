import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { verifyFirebaseToken, mintFirebaseToken, readJSON, documentId, aiRequest, rateLimit } from '../src/security.js';
import { createWorker } from '../src/secure-worker.js';

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const now = () => Math.floor(Date.now() / 1000);
const permit = { limit: async () => ({ success: true }) };
const env = {
    FIREBASE_PROJECT_ID: 'demo-coffee-security', FIREBASE_CLIENT_EMAIL: 'test@demo-coffee-security.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: await exportPKCS8(privateKey), PASSWORD_HASH: createHash('sha256').update('test-password-only').digest('hex'),
    LOGIN_RATE_LIMITER: permit, ADMIN_RATE_LIMITER: permit, AI_RATE_LIMITER: permit, GROQ_API_KEY: 'not-a-real-key',
};
async function token(overrides = {}, signingKey = privateKey) {
    return new SignJWT({ sub: 'coffee-site-admin', coffeeAdmin: true, coffeeSessionExpiresAt: now() + 3500,
        auth_time: now(), iat: now(), exp: now() + 3600, iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        aud: env.FIREBASE_PROJECT_ID, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(signingKey);
}
const key = async () => publicKey;
const worker = createWorker(key);
const request = (path, body, authorization) => new Request(`https://worker.test${path}`, {
    method: 'POST', headers: { Origin: 'https://2026coffeewebsite.vercel.app', 'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body),
});

test('admin requires a valid signature, project, role and finite login lifetime', async () => {
    assert.equal((await verifyFirebaseToken(await token(), env, key)).coffeeAdmin, true);
    const cases = [{ coffeeAdmin: false }, { sub: 'normal-user' }, { aud: 'another-project' }, { iss: 'https://attacker.test' },
        { exp: now() - 1 }, { auth_time: now() + 100 }, { iat: now() + 100 }, { coffeeSessionExpiresAt: now() - 1 },
        { coffeeSessionExpiresAt: now() + 7200 }, { coffeeSessionExpiresAt: '99999999999' }];
    for (const claims of cases) await assert.rejects(verifyFirebaseToken(await token(claims), env, key));
    const other = await generateKeyPair('RS256');
    await assert.rejects(verifyFirebaseToken(await token({}, other.privateKey), env, key));
    await assert.rejects(verifyFirebaseToken('session-123.fake', env, key));
});
test('password login returns signed Firebase custom token, not legacy session token', async () => {
    const response = await worker.fetch(request('/verify-password', { password: 'test-password-only' }), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.token, undefined);
    const { payload } = await jwtVerify(data.firebaseCustomToken, publicKey);
    assert.equal(payload.uid, 'coffee-site-admin');
    assert.equal(payload.claims.coffeeAdmin, true);
    assert.ok(payload.exp - payload.iat <= 300);
    assert.ok(payload.claims.coffeeSessionExpiresAt - payload.iat <= 3600);
    assert.equal((await worker.fetch(request('/verify-password', { password: 'wrong' }), env)).status, 401);
});
test('login rate limiting and missing configuration fail closed', async () => {
    assert.equal((await worker.fetch(request('/verify-password', { password: 'wrong' }), { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
    assert.equal((await worker.fetch(request('/verify-password', { password: 'wrong' }), { ...env, LOGIN_RATE_LIMITER: undefined })).status, 503);
    await assert.rejects(mintFirebaseToken({}), { status: 503 });
    await assert.rejects(rateLimit({ limit: async () => { throw new Error(); } }, 'key'), { status: 503 });
});
test('anonymous and non-admin calls cannot reach paid AI or deletion', async () => {
    for (const path of ['/', '/delete-record']) {
        assert.equal((await worker.fetch(request(path, {}), env)).status, 401);
        assert.equal((await worker.fetch(request(path, {}, await token({ coffeeAdmin: false })), env)).status, 403);
        assert.equal((await worker.fetch(request(path, {}, 'session-123.fake'), env)).status, 401);
    }
});
test('valid admin AI request is constrained before upstream call', async () => {
    const original = globalThis.fetch;
    let forwarded;
    globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        forwarded = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [] }), { headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const response = await worker.fetch(request('/', { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'coffee' }], max_completion_tokens: 99999, tools: [{ type: 'bad' }], n: 100 }, await token()), env);
        assert.equal(response.status, 200);
        assert.equal(forwarded.max_completion_tokens, 2000);
        assert.equal(forwarded.tools, undefined);
        assert.equal(forwarded.n, undefined);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    } finally { globalThis.fetch = original; }
});
test('delete is scoped to one document and forwards user token, not a service account', async () => {
    for (const id of ['../other', 'x/y', '%2e%2e', 'x?key=bad', 'x#fragment', '', null]) assert.throws(() => documentId(id));
    const original = globalThis.fetch;
    const idToken = await token();
    globalThis.fetch = async (url, options) => {
        assert.match(url, /\/documents\/coffee_roasts\/roast_123$/);
        assert.equal(options.headers.Authorization, `Bearer ${idToken}`);
        return new Response(null, { status: 204 });
    };
    try { assert.equal((await worker.fetch(request('/delete-record', { documentId: 'roast_123' }, idToken), env)).status, 200); }
    finally { globalThis.fetch = original; }
});
test('unknown routes/origins and oversize or malformed bodies are rejected', async () => {
    assert.equal((await worker.fetch(request('/unknown', {}), env)).status, 404);
    assert.equal((await worker.fetch(new Request('https://worker.test/', { method: 'POST' }), env)).status, 403);
    await assert.rejects(readJSON(request('/', { x: 'a'.repeat(100) }), 20), { status: 413 });
    await assert.rejects(readJSON(new Request('https://worker.test', { method: 'POST', body: '{}' })), { status: 415 });
    await assert.rejects(readJSON(request('/', [])), { status: 400 });
});
test('AI validates model, input shape, parameter types and token limits', () => {
    const base = { model: 'groq/compound-mini', messages: [{ role: 'user', content: 'coffee' }] };
    assert.equal(aiRequest(base).max_completion_tokens, 1200);
    for (const change of [{ model: 'other' }, { messages: [] }, { messages: [{ role: 'tool', content: 'x' }] }, { max_tokens: -1 }, { max_completion_tokens: '5000' }, { temperature: 3 }]) assert.throws(() => aiRequest({ ...base, ...change }));
});
