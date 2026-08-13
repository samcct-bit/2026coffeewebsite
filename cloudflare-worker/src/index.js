/**
 * 金成淬精品咖啡 · Cloudflare 中繼站 (Proxy)
 * Version: 3.0 — 安全性強化 + Firestore 伺服器端刪除代理
 */

const ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:3000",
    "https://gansingkim.com",
    "https://samcct-bit.github.io",
    "https://2026coffeewebsite.vercel.app"
];

const ALLOWED_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768"
];

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 簡易 SHA-256
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// 產生前端 Session Token (簡易 HMAC)
async function createSessionToken(env) {
    const data = "session-" + Date.now();
    const signature = await sha256(data + env.PASSWORD_HASH);
    return `${data}.${signature}`;
}

// 驗證前端 Session Token
async function verifySessionToken(token, env) {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [data, signature] = parts;
    
    // 檢查是否過期 (12小時)
    const timestamp = parseInt(data.replace("session-", ""), 10);
    if (Date.now() - timestamp > 12 * 60 * 60 * 1000) return false;

    const expectedSignature = await sha256(data + env.PASSWORD_HASH);
    return signature === expectedSignature;
}

// Rate Limiter
async function checkRateLimit(env, clientIP) {
    if (!env.RATE_LIMIT_KV) return { allowed: true };
    const key = `rl:${clientIP}`;
    const now = Date.now();
    try {
        const raw = await env.RATE_LIMIT_KV.get(key);
        let record = raw ? JSON.parse(raw) : { count: 0, windowStart: now };
        if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
            record = { count: 1, windowStart: now };
            await env.RATE_LIMIT_KV.put(key, JSON.stringify(record), { expirationTtl: 120 });
            return { allowed: true, count: 1 };
        }
        if (record.count >= RATE_LIMIT_MAX) {
            return { allowed: false, count: record.count };
        }
        record.count++;
        await env.RATE_LIMIT_KV.put(key, JSON.stringify(record), { expirationTtl: 120 });
        return { allowed: true, count: record.count };
    } catch {
        return { allowed: true };
    }
}

// --- Firebase Service Account JWT 相關函數 ---
function b64u(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uBuffer(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const pemToBuffer = (pem) => {
    const b64Lines = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const binary = atob(b64Lines);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

const getGoogleAccessToken = async (env) => {
    if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Missing Firebase credentials in environment variables.");
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/datastore'
    };

    const encodedHeader = b64u(JSON.stringify(header));
    const encodedPayload = b64u(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const privateKeyBuffer = pemToBuffer(env.FIREBASE_PRIVATE_KEY);
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        privateKeyBuffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
        false,
        ['sign']
    );

    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        encoder.encode(dataToSign)
    );

    const jwt = `${dataToSign}.${b64uBuffer(signatureBuffer)}`;

    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!resp.ok) {
        throw new Error("Failed to get Google Access Token: " + await resp.text());
    }
    
    const data = await resp.json();
    return data.access_token;
};

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin");
        const url = new URL(request.url);
        const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowedOrigin ? origin : ALLOWED_ORIGINS[4],
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (!isAllowedOrigin) {
            return new Response(JSON.stringify({ error: "Forbidden: Origin not allowed" }), {
                status: 403, headers: { "Content-Type": "application/json" }
            });
        }

        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
                status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const path = url.pathname;

        // ── 路由 A：密碼驗證 `/verify-password` ──
        if (path === "/verify-password") {
            try {
                const body = await request.json();
                const inputPassword = body.password || "";
                const storedHash = env.PASSWORD_HASH;
                if (!storedHash) {
                    return new Response(JSON.stringify({ error: "Server config error" }), {
                        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }
                const inputHash = await sha256(inputPassword);
                const isValid = inputHash === storedHash;
                const sessionToken = isValid ? await createSessionToken(env) : null;

                return new Response(JSON.stringify({ success: isValid, token: sessionToken }), {
                    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: "Invalid request" }), {
                    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
        }

        // ── 路由 B：刪除文件 `/delete-record` ──
        if (path === "/delete-record") {
            try {
                const body = await request.json();
                const { token, documentId } = body;
                
                // 1. 驗證 Session Token
                const isValidToken = await verifySessionToken(token, env);
                if (!isValidToken) {
                    return new Response(JSON.stringify({ error: "Unauthorized or expired token" }), {
                        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }
                
                if (!documentId) {
                    return new Response(JSON.stringify({ error: "Missing documentId" }), {
                        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }

                // 2. 取得 Firebase Access Token
                const accessToken = await getGoogleAccessToken(env);
                const projectId = env.FIREBASE_PROJECT_ID || "my-teaching-tools-01";
                
                // 3. 呼叫 Firestore REST API 刪除文件
                const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/coffee_roasts/${documentId}`;
                
                const deleteResp = await fetch(firestoreUrl, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });

                if (!deleteResp.ok) {
                    const errText = await deleteResp.text();
                    return new Response(JSON.stringify({ error: "Failed to delete document from Firestore", details: errText }), {
                        status: deleteResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }

                return new Response(JSON.stringify({ success: true }), {
                    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
        }

        // ── 路由 C：AI 生成（預設 `/`） ──
        const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
        const rateCheck = await checkRateLimit(env, clientIP);
        if (!rateCheck.allowed) {
            return new Response(JSON.stringify({ error: "Too Many Requests. Please wait a moment." }), {
                status: 429,
                headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" }
            });
        }

        if (!env.GROQ_API_KEY) {
            return new Response(JSON.stringify({ error: "Server Configuration Error: API Key missing" }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        try {
            const body = await request.json();
            if (body.model && !ALLOWED_MODELS.includes(body.model)) {
                return new Response(JSON.stringify({ error: `Model '${body.model}' is not allowed` }), {
                    status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
            if (body.max_tokens && body.max_tokens > 2000) {
                body.max_tokens = 2000;
            }

            const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            const data = await groqResponse.json();
            return new Response(JSON.stringify(data), {
                status: groqResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    }
};