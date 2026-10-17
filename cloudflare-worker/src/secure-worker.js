import { HttpError, readJSON, checkPassword, mintFirebaseToken, verifyFirebaseToken, rateLimit, documentId, aiRequest } from './security.js';

const ORIGINS = ['https://gansingkim.com', 'https://samcct-bit.github.io', 'https://2026coffeewebsite.vercel.app'];

// resolveKey 僅由離線測試注入；HTTP 輸入不能指定驗證器或公鑰。
export function createWorker(resolveKey) {
    return {
        async fetch(request, env) {
            const origin = request.headers.get('Origin');
            const allowed = ORIGINS.includes(origin) || (env.ALLOW_LOCALHOST === 'true' && ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'].includes(origin));
            const headers = {
                'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
                'X-Content-Type-Options': 'nosniff',
                ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } : {}),
            };
            const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
            try {
                if (!allowed) throw new HttpError(403, 'Origin not allowed');
                const path = new URL(request.url).pathname;
                if (!['/', '/verify-password', '/delete-record'].includes(path)) throw new HttpError(404, 'Not found');
                if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
                if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
                const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                if (path === '/verify-password') {
                    await rateLimit(env.LOGIN_RATE_LIMITER, `coffee-login:${ip}`);
                    const body = await readJSON(request, 2048);
                    if (!await checkPassword(body.password, env)) throw new HttpError(401, 'Invalid credentials');
                    return reply({ success: true, firebaseCustomToken: await mintFirebaseToken(env) });
                }
                // 所有付費及破壞性操作先驗證 Firebase ID token，不能只相信 Origin。
                const authorization = request.headers.get('Authorization') || '';
                if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sign in required');
                const admin = await verifyFirebaseToken(authorization.slice(7), env, resolveKey);
                await rateLimit(env.ADMIN_RATE_LIMITER, `coffee-admin:${admin.sub}`);
                if (path === '/delete-record') {
                    const body = await readJSON(request, 2048);
                    const id = documentId(body.documentId);
                    // 使用已驗證的使用者 token，讓 Firestore 規則再檢查一次，不再用服務帳戶繞過規則。
                    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/coffee_roasts/${encodeURIComponent(id)}`;
                    const response = await fetch(url, { method: 'DELETE', headers: { Authorization: authorization }, signal: AbortSignal.timeout(15000) });
                    if (!response.ok) throw new HttpError(response.status === 403 ? 403 : 502, 'Delete failed; record unchanged');
                    return reply({ success: true });
                }
                await rateLimit(env.AI_RATE_LIMITER, `coffee-ai:${admin.sub}`);
                if (!env.GROQ_API_KEY) throw new HttpError(503, 'AI unavailable');
                const body = aiRequest(await readJSON(request));
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
                });
                if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'AI provider unavailable');
                // 串流轉送已限定輸出量的 JSON，避免緩衝不必要的供應商回應。
                return new Response(response.body, { status: 200, headers });
            } catch (error) {
                if (error instanceof HttpError) return reply({ error: error.message }, error.status);
                // 不回傳上游內容、secret、stack trace 或完整請求。
                console.error('coffee_proxy_failure', error?.name || 'Error');
                return reply({ error: 'Service temporarily unavailable' }, 503);
            }
        },
    };
}

export default createWorker();
