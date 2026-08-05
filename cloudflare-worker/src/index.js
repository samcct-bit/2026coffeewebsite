/**
 * 金成淬精品咖啡 · Groq API Cloudflare 中繼站 (Proxy)
 * Version: 2.0 — 安全性強化版本
 * - 負責隱藏 Groq API Key (存放於 Cloudflare Secrets)
 * - 負責 CORS 網域白名單檢查（已修正 !origin 繞過漏洞）
 * - 負責密碼驗證（Hash 從前端移至 Worker Secret）
 * - 負責 Rate Limiting（每個 IP 每分鐘最多 10 次呼叫）
 * - 負責 payload 白名單（防止使用者切換高費用 model）
 */

const ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:3000",
    "https://gansingkim.com",
    "https://samcct-bit.github.io"
];

// 允許的 AI 模型白名單（防止惡意切換昂貴 model）
const ALLOWED_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768"
];

// Rate limit 設定：每個 IP 每分鐘最多 10 次
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 簡易 SHA-256（Worker 內建 Web Crypto API）
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Rate Limiter（使用 Cloudflare KV，若未設定則略過）
async function checkRateLimit(env, clientIP) {
    if (!env.RATE_LIMIT_KV) return { allowed: true }; // KV 未設定時允許通過

    const key = `rl:${clientIP}`;
    const now = Date.now();

    try {
        const raw = await env.RATE_LIMIT_KV.get(key);
        let record = raw ? JSON.parse(raw) : { count: 0, windowStart: now };

        // 若超出時間視窗，重置計數
        if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
            record = { count: 1, windowStart: now };
            await env.RATE_LIMIT_KV.put(key, JSON.stringify(record), { expirationTtl: 120 });
            return { allowed: true, count: 1 };
        }

        // 計數超限
        if (record.count >= RATE_LIMIT_MAX) {
            return { allowed: false, count: record.count };
        }

        // 計數增加
        record.count++;
        await env.RATE_LIMIT_KV.put(key, JSON.stringify(record), { expirationTtl: 120 });
        return { allowed: true, count: record.count };
    } catch {
        return { allowed: true }; // KV 錯誤時允許通過
    }
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin");
        const url = new URL(request.url);

        // ── 1. CORS 白名單檢查（修正：移除 !origin 繞過漏洞） ──
        // 只允許已知白名單 origin，無 origin（如 curl）一律拒絕
        const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowedOrigin ? origin : ALLOWED_ORIGINS[4],
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        };

        // ── 2. 處理 Preflight ──
        if (request.method === "OPTIONS") {
            // Preflight 允許（瀏覽器需要 OPTIONS 才能發 POST）
            return new Response(null, { headers: corsHeaders });
        }

        // ── 3. 非白名單 origin 一律 403 ──
        if (!isAllowedOrigin) {
            return new Response(JSON.stringify({ error: "Forbidden: Origin not allowed" }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
            });
        }

        // ── 4. 只允許 POST ──
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // ── 5. Rate Limiting ──
        const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
        const rateCheck = await checkRateLimit(env, clientIP);
        if (!rateCheck.allowed) {
            return new Response(JSON.stringify({ error: "Too Many Requests. Please wait a moment." }), {
                status: 429,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": "60"
                }
            });
        }

        // ── 路由分發 ──
        const path = url.pathname;

        // ── 路由 A：密碼驗證 `/verify-password` ──
        if (path === "/verify-password") {
            try {
                const body = await request.json();
                const inputPassword = body.password || "";

                // 從 Worker Secret 取得 hash（透過 wrangler secret put PASSWORD_HASH 設定）
                const storedHash = env.PASSWORD_HASH;
                if (!storedHash) {
                    return new Response(JSON.stringify({ error: "Server config error" }), {
                        status: 500,
                        headers: { ...corsHeaders, "Content-Type": "application/json" }
                    });
                }

                const inputHash = await sha256(inputPassword);
                const isValid = inputHash === storedHash;

                // 若驗證成功，回傳一次性 session token（UUID）
                const sessionToken = isValid ? crypto.randomUUID() : null;

                return new Response(JSON.stringify({ success: isValid, token: sessionToken }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: "Invalid request" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }
        }

        // ── 路由 B：AI 生成（預設 `/`） ──
        if (!env.GROQ_API_KEY) {
            return new Response(JSON.stringify({ error: "Server Configuration Error: API Key missing" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        try {
            const body = await request.json();

            // ── 6. Payload 白名單：防止切換昂貴 model ──
            if (body.model && !ALLOWED_MODELS.includes(body.model)) {
                return new Response(JSON.stringify({ error: `Model '${body.model}' is not allowed` }), {
                    status: 403,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            // ── 7. max_tokens 上限防護（防止超大量請求） ──
            if (body.max_tokens && body.max_tokens > 2000) {
                body.max_tokens = 2000;
            }

            // ── 8. 轉發至 Groq API ──
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
                status: groqResponse.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message || "Internal Server Error" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    },
};
