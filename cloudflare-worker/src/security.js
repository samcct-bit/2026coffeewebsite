import { timingSafeEqual } from 'node:crypto';
import { SignJWT, importPKCS8, importX509, jwtVerify } from 'jose';

export const ADMIN_UID = 'coffee-site-admin';
export const SESSION_SECONDS = 60 * 60;
const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

export async function readJSON(request, maxBytes = 65536) {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'JSON required');
    if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'Request too large');
    if (!request.body) throw new HttpError(400, 'JSON required');
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try {
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        return body;
    } catch { throw new HttpError(400, 'Invalid JSON object'); }
}

export async function checkPassword(password, env) {
    if (typeof password !== 'string' || !password || password.length > 256) throw new HttpError(400, 'Invalid password input');
    // 遷移相容既有伺服器 Secret；不把 hash／密碼交給瀏覽器。
    if (!/^[a-f0-9]{64}$/i.test(env.PASSWORD_HASH || '')) throw new HttpError(503, 'Authentication not configured');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)));
    const expected = Uint8Array.from(env.PASSWORD_HASH.match(/../g), byte => parseInt(byte, 16));
    return timingSafeEqual(hash, expected);
}

export async function mintFirebaseToken(env) {
    if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new HttpError(503, 'Authentication not configured');
    const now = Math.floor(Date.now() / 1000);
    const key = await importPKCS8(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
    return new SignJWT({ uid: ADMIN_UID, claims: { coffeeAdmin: true, coffeeSessionExpiresAt: now + SESSION_SECONDS } })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(env.FIREBASE_CLIENT_EMAIL).setSubject(env.FIREBASE_CLIENT_EMAIL)
        .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
        .setIssuedAt(now).setExpirationTime(now + 300).sign(key);
}

async function googleKey(header) {
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new HttpError(401, 'Invalid credentials');
    // Cache API 只保存公開憑證，不保存每位使用者的 token 或身分。
    const cache = globalThis.caches?.default;
    let response = cache ? await cache.match(CERT_URL) : null;
    if (!response) {
        response = await fetch(CERT_URL, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new HttpError(503, 'Authentication temporarily unavailable');
        if (cache) await cache.put(CERT_URL, response.clone());
    }
    const certs = await response.json();
    if (!Object.hasOwn(certs, header.kid) || typeof certs[header.kid] !== 'string') throw new HttpError(401, 'Unknown signing key');
    return importX509(certs[header.kid], 'RS256');
}

export async function verifyFirebaseToken(token, env, resolveKey = googleKey) {
    if (typeof token !== 'string' || token.length > 8192) throw new HttpError(401, 'Sign in required');
    if (!env.FIREBASE_PROJECT_ID) throw new HttpError(503, 'Authentication not configured');
    let payload;
    try {
        ({ payload } = await jwtVerify(token, resolveKey, {
            algorithms: ['RS256'], audience: env.FIREBASE_PROJECT_ID,
            issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
            requiredClaims: ['exp', 'iat', 'auth_time', 'sub'],
        }));
    } catch (error) {
        if (error instanceof HttpError && error.status === 503) throw error;
        throw new HttpError(401, 'Invalid or expired credentials');
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== ADMIN_UID || payload.coffeeAdmin !== true) throw new HttpError(403, 'Administrator required');
    if (!Number.isInteger(payload.auth_time) || payload.auth_time > now || payload.iat > now ||
        !Number.isInteger(payload.coffeeSessionExpiresAt) || payload.coffeeSessionExpiresAt <= now ||
        payload.coffeeSessionExpiresAt > payload.auth_time + SESSION_SECONDS || now - payload.auth_time >= SESSION_SECONDS) {
        throw new HttpError(401, 'Please sign in again');
    }
    return payload;
}

export async function rateLimit(binding, key) {
    if (!binding) throw new HttpError(503, 'Rate limiter unavailable');
    try {
        const result = await binding.limit({ key });
        if (!result.success) throw new HttpError(429, 'Too many requests; retry later');
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'Rate limiter unavailable');
    }
}

export function documentId(value) {
    // 僅允許單一文件名稱；不得帶入 path/query/fragment 或編碼繞過。
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new HttpError(400, 'Invalid document ID');
    return value;
}

export function aiRequest(body) {
    const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound', 'groq/compound-mini'];
    if (!models.includes(body.model)) throw new HttpError(400, 'Unsupported model');
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 12) throw new HttpError(400, 'Invalid messages');
    const messages = body.messages.map(message => {
        if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 24000) throw new HttpError(400, 'Invalid message');
        return { role: message.role, content: message.content };
    });
    if (messages.reduce((sum, message) => sum + message.content.length, 0) > 40000) throw new HttpError(413, 'Prompt too long');
    const tokens = body.max_completion_tokens ?? body.max_tokens ?? 1200;
    if (!Number.isInteger(tokens) || tokens < 1) throw new HttpError(400, 'Invalid token limit');
    const temperature = body.temperature ?? 0.4;
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new HttpError(400, 'Invalid temperature');
    const result = { model: body.model, messages, max_completion_tokens: Math.min(tokens, 2000), temperature, stream: false };
    if (body.model.startsWith('groq/compound')) {
        result.citation_options = 'enabled';
        result.search_settings = { country: 'tw' };
    } else {
        result.response_format = { type: 'json_object' };
        if (body.model.startsWith('openai/gpt-oss')) { result.reasoning_effort = 'low'; result.reasoning_format = 'hidden'; }
    }
    // 不轉送任意 tools、URL、n、stream 或搜尋設定。
    return result;
}
