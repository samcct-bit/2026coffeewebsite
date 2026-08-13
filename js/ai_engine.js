/**
 * 金成淬精品咖啡 · AI 引擎模組
 * Groq LLM API 整合 · 品牌一致性風味文案生成
 * Version: 2.1 | 2026-08-04
 * Key Source: C:\2026_key\groq_coffeewebsite.txt
 */

// ──────────────────────────────────────────────
// API 中繼層：改由 Cloudflare Workers 代理，不再儲存金鑰於前端
// ──────────────────────────────────────────────


const GROQ_CONFIG = {
    model: "llama-3.3-70b-versatile",
    endpoint: "https://gsk-groq-proxy.gansingkim.workers.dev", // ← 請在部署後將此替換為您的 Cloudflare Worker 網址
    maxTokens: 700,
    temperature: 0.88
};

// ──────────────────────────────────────────────
// 金成淬品牌 System Prompt
// ──────────────────────────────────────────────
const BRAND_SYSTEM_PROMPT = `你是「金成淬」精品咖啡品牌的首席品鑑師與美學文案撰稿人。金成淬由持有 SCA Brewing（金杯理論）與 SCA Roasting 中級國際認證的咖啡師創立，專注於微批次精品熟豆的極致烘焙與風土展現。

你的雙重角色：
1. 精通 SCA 杯測科學，熟悉 ROR、DTR、梅納反應、焦糖化、發展時間等烘焙術語
2. 具備日本高端美學素養，文字風格如詩如畫、意象豐富、禪意流動

【輸出格式】嚴格遵守以下 JSON，不可有任何前綴文字或 markdown：
{
    "topNote": "初韻香氣，12-18字，用「、」分隔2-3種具體香氣意象",
    "midNote": "中調風味，12-18字，強調果汁感/甜感/口感層次",
    "baseNote": "尾韻，12-18字，強調回甘/餘韻/尾段印象",
    "storyCopy": "90-130字品牌故事文案，融入具體風土地理、烘焙工藝細節、金成淬職人精神，結尾帶出邀請品飲的情境。",
    "brewTip": "沖煮建議一句話，包含水溫範圍與研磨度建議（20字以內）"
}

【風格禁忌】：
- 禁用：香甜、好喝、濃郁（太平庸）
- 禁用：英文夾雜（除非是品種或技術名詞）
- 禁用：過度堆疊感嘆號

【風格範例（初韻）】：
- 好：「晨露玫瑰、野莓綻放」「茉莉仙氣、佛手柑皮」「馥郁紫羅蘭、晨採白桃」
- 壞：「花香四溢」「非常香」`;

// ──────────────────────────────────────────────
// sessionStorage 快取層（同豆款不重複呼叫 API）
// ──────────────────────────────────────────────
const CACHE_PREFIX = '_gskai_cache_';
const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72 小時 TTL（改用 localStorage 跨分頁保留）

/**
 * 產生快取 Key（根據豆款核心特徵）
 * @param {Object} beanData
 * @returns {string}
 */
function _buildCacheKey(beanData) {
    const sig = [
        beanData.name    || '',
        beanData.origin  || '',
        beanData.process || '',
        beanData.roastLevel || ''
    ].join('|').toLowerCase().replace(/\s+/g, '');
    // 簡易 hash（避免 key 太長）
    let h = 0;
    for (let i = 0; i < sig.length; i++) {
        h = Math.imul(31, h) + sig.charCodeAt(i) | 0;
    }
    return CACHE_PREFIX + Math.abs(h).toString(36);
}

/** 從快取讀取（TTL 過期則視為 miss）— 使用 localStorage 跨分頁保留 72 小時 */
function _readCache(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

/** 寫入快取 */
function _writeCache(cacheKey, data) {
    try {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch {
        // localStorage 可能已滿，清除舊快取後重試
        try {
            clearAICache();
            localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
        } catch { /* 忽略 */ }
    }
}

// ──────────────────────────────────────────────
// 主要：咖啡風味 AI 生成（含快取）
// ──────────────────────────────────────────────
/**
 * @param {Object} beanData - 咖啡豆資料
 * @param {string} beanData.name - 豆款名稱
 * @param {string} beanData.origin - 產區
 * @param {string} beanData.process - 處理法
 * @param {string} beanData.roastLevel - 烘焙度
 * @param {string} [beanData.altitude] - 海拔
 * @param {string} [beanData.variety] - 品種
 * @param {string} [beanData.dtr] - 發展時間比 DTR
 * @param {string} [beanData.lossRatio] - 失重比
 * @param {string} [beanData.machine] - 烘豆機型
 * @param {boolean} [beanData.bypassCache] - 強制繞過快取（手動重新生成時使用）
 * @returns {Promise<{topNote, midNote, baseNote, storyCopy, brewTip}>}
 */
async function generateCoffeeFlavorAI(beanData) {
    const {
        name = "精品咖啡",
        origin = "精選產區",
        process = "精選處理法",
        roastLevel = "淺焙",
        altitude = "",
        variety = "",
        dtr = "",
        lossRatio = "",
        machine = "職人烘豆機",
        bypassCache = false
    } = beanData;

    // ── 快取命中檢查 ──
    const cacheKey = _buildCacheKey(beanData);
    if (!bypassCache) {
        const cached = _readCache(cacheKey);
        if (cached) {
            console.log(`[AI Cache HIT] ${name} · ${origin}`);
            return cached;
        }
    }

    const userPrompt = `請根據以下咖啡生豆資料，生成金成淬品牌風格的三段式風味描述與品牌文案：

豆款名稱：${name}
產區：${origin}
處理法：${process}
烘焙度：${roastLevel}
${altitude ? `海拔：${altitude}` : ""}
${variety ? `品種：${variety}` : ""}
${dtr ? `發展時間比 DTR：${dtr}（${parseFloat(dtr) >= 20 ? "偏長，風味更圓潤飽滿" : parseFloat(dtr) <= 13 ? "偏短，花香更細緻通透" : "標準黃金DTR範圍"})` : ""}
${lossRatio ? `烘焙失重率：${lossRatio}` : ""}
烘豆設備：${machine}

請嚴格按照指定 JSON 格式輸出，不要有任何其他文字。`;

    try {
        const response = await fetch(GROQ_CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: GROQ_CONFIG.model,
                messages: [
                    { role: "system", content: BRAND_SYSTEM_PROMPT },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: GROQ_CONFIG.maxTokens,
                temperature: GROQ_CONFIG.temperature,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Groq API 錯誤 ${response.status}: ${errBody}`);
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(rawContent);

        const result = {
            topNote:   parsed.topNote   || `${origin}高雅花香、初摘柑橘`,
            midNote:   parsed.midNote   || "明亮果蜜、甜感交響",
            baseNote:  parsed.baseNote  || "清雅白花餘韻、黑糖甘甜悠長",
            storyCopy: parsed.storyCopy || `來自${origin}的微批次精品豆，經金成淬職人精密烘焙淬煉。`,
            brewTip:   parsed.brewTip   || "建議水溫 88°C - 92°C，中偏粗研磨"
        };

        // ── 寫入快取 ──
        _writeCache(cacheKey, result);
        console.log(`[AI Cache WRITE] ${name} · ${origin}`);

        return result;

    } catch (err) {
        console.error("[AI Engine] Groq API 呼叫失敗:", err);
        return {
            topNote:   `${origin}高雅花香、初摘果香`,
            midNote:   "明亮果蜜、甜感層次交響",
            baseNote:  "清雅餘韻、黑糖甘甜悠長",
            storyCopy: `來自${origin}的微批次精品豆，採${process}精緻淬煉，經金成淬職人以科學化 ROR 烘焙曲線呈現最純粹的風土本質。`,
            brewTip:   "建議水溫 88°C - 92°C，中偏粗研磨"
        };
    }
}

// ──────────────────────────────────────────────
// 進階：烘焙曲線 ROR AI 診斷（for roast_live.html）
// ──────────────────────────────────────────────
/**
 * @param {Object} roastData - 烘焙數據
 * @param {Array} roastData.rorPoints - ROR 觀測點陣列 [{time, bt, ror}]
 * @param {string} roastData.dtr - 發展時間比
 * @param {string} roastData.lossRatio - 失重比
 * @param {string} roastData.beanName - 豆名
 * @param {string} roastData.roastLevel - 烘焙度
 */
async function generateRORDiagnosis(roastData) {
    const { rorPoints = [], dtr = "", lossRatio = "", beanName = "", roastLevel = "" } = roastData;

    const rorSummary = rorPoints.slice(-6).map(p =>
        `${p.time}: BT=${p.bt}°C, ROR=${p.ror}`
    ).join(" | ");

    const diagPrompt = `你是 SCA 認證烘焙師，請診斷以下「${beanName}」的烘焙數據，並給出職人改善建議。

烘焙度目標：${roastLevel}
發展時間比（DTR）：${dtr}
失重比：${lossRatio}
最後段 ROR 觀測數據：${rorSummary || "暫無數據"}

請用 JSON 輸出（繁體中文）：
{
    "overallScore": "優秀/良好/需改善",
    "dtrEval": "DTR 評價（一句話）",
    "lossEval": "失重比評價（一句話）",
    "rorTrend": "ROR 走勢分析（一句話）",
    "suggestion": "下批次改善建議（2-3點，每點15字內）",
    "badge": "本批次特色評語（10字以內，如「焦糖化完美」「花香保留極優」）"
}`;

    try {
        const response = await fetch(GROQ_CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "你是一位持有 SCA Roasting 國際認證的精品咖啡烘焙顧問，專精於 ROR 曲線分析與 DTR 發展比優化。回答嚴格以 JSON 格式輸出，使用繁體中文。" },
                    { role: "user", content: diagPrompt }
                ],
                max_tokens: 500,
                temperature: 0.7,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        return JSON.parse(data.choices?.[0]?.message?.content || "{}");

    } catch (err) {
        console.error("[AI Engine] ROR 診斷失敗:", err);
        const dtrNum = parseFloat(dtr);
        return {
            overallScore: "良好",
            dtrEval: dtrNum >= 20 ? "DTR 偏長，風味圓潤但建議縮短" : dtrNum <= 13 ? "DTR 偏短，花香通透但甜感可加強" : "DTR 落在黃金範圍，曲線平衡",
            lossEval: "失重比數據已記錄",
            rorTrend: "ROR 曲線正常下降，熱能控制穩定",
            suggestion: ["保持 ROR 穩定下降趨勢", "確保一爆後 DTR 控制在目標範圍", "注意出豆溫度與風門配合"],
            badge: "職人標準批次"
        };
    }
}

// ──────────────────────────────────────────────
// 進階：Obsidian 筆記 AI 詩句生成（for roast_db.html）
// ──────────────────────────────────────────────
/**
 * 為 Obsidian 匯出筆記生成 AI 詩意品鑑段落
 * @param {Object} recData - 烘焙紀錄資料
 * @returns {Promise<{haiku, tasting, craftNote}>}
 */
async function generateObsidianPoetry(recData) {
    const { beanName = "", origin = "", process = "", roastLevel = "",
            dtrRatio = "", lossRatio = "", flavorTop = "", flavorMid = "", flavorBase = "" } = recData;

    // 檢查快取（用豆名+烘焙日期作為唯一標識）
    const cacheKey = _buildCacheKey({ name: beanName + '_obsidian', origin, process, roastLevel });
    const cached = _readCache(cacheKey);
    if (cached) return cached;

    const poetryPrompt = `你是「金成淬」精品咖啡品牌的詩意文案師與 SCA 品鑑師。
請根據以下這批次烘焙資料，生成一份適合收錄進職人筆記的文學性品鑑段落。

豆款：${beanName}（${origin}）
處理法：${process} ‧ 烘焙度：${roastLevel}
DTR：${dtrRatio} ‧ 失重：${lossRatio}
已知風味輪廓：${[flavorTop, flavorMid, flavorBase].filter(Boolean).join('、') || '待評鑑'}

請以 JSON 格式輸出（繁體中文，文學性強、禁用平凡語彙）：
{
    "haiku": "一首三行俳句（每行5-7字），捕捉此批次的靈魂意境",
    "tasting": "80-100字詩意品鑑段落，描述從入口到尾韻的時間旅程",
    "craftNote": "30-50字職人烘焙工藝備忘，記錄此批次的技術亮點或挑戰"
}`;

    try {
        const response = await fetch(GROQ_CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: GROQ_CONFIG.model,
                messages: [
                    { role: "system", content: "你是精品咖啡品牌的詩意文案師，擅長以俳句與禪意散文記錄咖啡的風土靈魂。回答嚴格以 JSON 格式輸出，使用繁體中文。" },
                    { role: "user", content: poetryPrompt }
                ],
                max_tokens: 500,
                temperature: 0.92,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");

        const result = {
            haiku:     parsed.haiku     || `${origin}山嵐晨起\n火候精算每一秒\n杯底見風土`,
            tasting:   parsed.tasting   || `${beanName}的風味，在杯中緩緩綻放——如同${origin}高地的晨霧，悠然而不可捉摸。`,
            craftNote: parsed.craftNote || `DTR ${dtrRatio}，失重 ${lossRatio}，本批次曲線穩定，風味發展均衡。`
        };

        _writeCache(cacheKey, result);
        return result;

    } catch (err) {
        console.error("[AI Engine] Obsidian 詩句生成失敗:", err);
        return {
            haiku:     `${origin}山嵐起\n職人火候淬精魂\n杯中見風土`,
            tasting:   `${beanName}，來自${origin}的微批次傑作。入口清雅，中段豐盈，尾韻悠長，每一口都是職人心血的凝練。`,
            craftNote: `DTR ${dtrRatio}，失重 ${lossRatio}，ROR 曲線穩定，本批次達到金成淬品質標準。`
        };
    }
}

// ──────────────────────────────────────────────
// 工具函式：打字機效果填入欄位
// ──────────────────────────────────────────────
/**
 * @param {string} elementId - 目標元素 ID
 * @param {string} text - 要填入的文字
 * @param {number} [speed=18] - 打字速度（ms/字）
 * @returns {Promise<void>}
 */
function typewriterFill(elementId, text, speed = 18) {
    return new Promise(resolve => {
        const el = document.getElementById(elementId);
        if (!el) { resolve(); return; }

        el.value = "";
        let i = 0;
        const timer = setInterval(() => {
            if (i < text.length) {
                el.value += text[i];
                i++;
            } else {
                clearInterval(timer);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                resolve();
            }
        }, speed);
    });
}

// ──────────────────────────────────────────────
// 工具函式：顯示 AI 載入狀態
// ──────────────────────────────────────────────
function showAILoading(buttonEl, loadingText = "✨ AI 生成中...") {
    if (!buttonEl) return;
    buttonEl._originalText = buttonEl.innerHTML;
    buttonEl.innerHTML = `<span class="animate-pulse">${loadingText}</span>`;
    buttonEl.disabled = true;
    buttonEl.style.opacity = "0.7";
    buttonEl.style.cursor = "wait";
}

function hideAILoading(buttonEl) {
    if (!buttonEl || !buttonEl._originalText) return;
    buttonEl.innerHTML = buttonEl._originalText;
    buttonEl.disabled = false;
    buttonEl.style.opacity = "";
    buttonEl.style.cursor = "";
}

// ──────────────────────────────────────────────
// 安全性：密碼驗證（改由 Cloudflare Worker 伺服器端比對，Hash 不再存於前端）
// ──────────────────────────────────────────────
/**
 * 向 Cloudflare Worker 的 /verify-password endpoint 驗證密碼
 * Hash 儲存於 Worker Secret（PASSWORD_HASH），前端不再持有
 * @param {string} inputPassword - 使用者輸入的密碼（明文，透過 HTTPS 傳輸）
 * @returns {Promise<boolean>}
 */
async function verifyPasswordSecure(inputPassword) {
    try {
        const response = await fetch(`${GROQ_CONFIG.endpoint}/verify-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: inputPassword })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        // 若驗證成功，將 session token 存入 sessionStorage（更安全：可在 Worker 端登出）
        if (result.success && result.token) {
            sessionStorage.setItem("roast_db_token", result.token);
        }
        return result.success === true;
    } catch (err) {
        console.error("[Auth] 密碼驗證請求失敗:", err);
        return false;
    }
}

// ──────────────────────────────────────────────
// 快取管理工具
// ──────────────────────────────────────────────
/** 清除所有 AI 快取（供使用者手動清除時使用） */
function clearAICache() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
    console.log(`[AI Cache] 已清除 ${keys.length} 筆快取`);
    return keys.length;
}

// 全域匯出
window.GansingKimAI = {
    generateCoffeeFlavorAI,
    generateRORDiagnosis,
    generateObsidianPoetry,
    typewriterFill,
    showAILoading,
    hideAILoading,
    verifyPasswordSecure,
    clearAICache,
    endpoint: GROQ_CONFIG.endpoint,
    isKeyReady: () => true
    // PASSWORD_HASH 已從前端移除，改由 Cloudflare Worker 伺服器端保管
};
