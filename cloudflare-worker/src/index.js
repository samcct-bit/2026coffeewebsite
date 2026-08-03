/**
 * 金成淬精品咖啡 · Groq API Cloudflare 中繼站 (Proxy)
 * - 負責隱藏 API Key (存放於 Cloudflare Secrets)
 * - 負責 CORS 網域白名單檢查
 */

// 您未來實際部署的網域名稱，或者測試用的 Github Pages 網址
// 例如: "https://your-domain.com", "https://samcct.github.io"
const ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:3000",
    "https://gansingkim.com", // 預設正式網址
    "https://samcct-bit.github.io" // GitHub Pages 網址
];

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin");
        
        // 1. 檢查來源是否在白名單中
        const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin) || !origin; 
        // 註: 若是從同網域打或特定工具打可能沒有 Origin，可根據安全需求決定 !origin 是否放行

        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        };

        // 2. 處理瀏覽器的預檢請求 (Preflight)
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // 阻擋不在白名單的請求 (OPTIONS 以外的請求)
        if (!isAllowedOrigin && origin) {
            return new Response(JSON.stringify({ error: "Forbidden: Origin not allowed" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 3. 檢查環境變數是否有金鑰
        if (!env.GROQ_API_KEY) {
            return new Response(JSON.stringify({ error: "Server Configuration Error: API Key missing" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // 4. 只允許 POST 請求
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        try {
            // 解析前端傳來的 Request Body
            const body = await request.json();

            // 5. 轉發請求到 Groq API
            const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.GROQ_API_KEY}`, // 使用後台安全金鑰
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            // 取得回傳內容
            const data = await groqResponse.json();

            // 6. 將結果回傳給前端，並加上 CORS Headers
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
