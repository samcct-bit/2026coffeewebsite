/**
 * 金成淬精品咖啡 · AI 引擎模組
 * Groq LLM API 整合 · 品牌一致性風味文案生成
 * Version: 2.2 | 2026-08-31
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
// localStorage 快取層（同一批次不重複呼叫 API）
// ──────────────────────────────────────────────
const CACHE_PREFIX = '_gskai_cache_';
const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72 小時 TTL（改用 localStorage 跨分頁保留）
const CACHE_KEY_VERSION = 'batch-aware-v4';

/** 將物件穩定排序，避免相同批次因欄位順序不同產生不同快取鍵。 */
function _stableCacheValue(value) {
    if (Array.isArray(value)) return value.map(_stableCacheValue);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((result, key) => {
            if (value[key] !== undefined) result[key] = _stableCacheValue(value[key]);
            return result;
        }, {});
    }
    return value;
}

/** 統一新舊格式的 ROR 觀測點，讓 AI 一律取得數值化的完整曲線。 */
function _toNumericOrEmpty(value) {
    if (value === '' || value === null || value === undefined) return '';
    const number = Number(value);
    return Number.isFinite(number) ? number : '';
}

function _normalizeRorPoints(points = []) {
    if (!Array.isArray(points)) return [];
    return points.map(point => {
        const isArray = Array.isArray(point);
        const timeCandidate = isArray ? point[0] : (point?.time ?? point?.timeStr ?? '');
        const time = !isArray && !timeCandidate && point?.timeS !== undefined && Number.isFinite(Number(point.timeS))
            ? `${Math.floor(Number(point.timeS) / 60)}:${Number(point.timeS) % 60 < 10 ? '0' : ''}${Number(point.timeS) % 60}`
            : timeCandidate;
        const bt = isArray ? point[1] : (point?.bt ?? point?.beanTemp ?? point?.temp ?? '');
        const ror = isArray ? point[2] : (point?.ror ?? '');
        return {
            time: String(time ?? '').trim(),
            bt: _toNumericOrEmpty(bt),
            ror: _toNumericOrEmpty(ror),
        };
    }).filter(point => point.time && point.bt !== '');
}

/** 以完整曲線建立提示詞內容；不只取最後幾點，避免不同批次被截成相同資料。 */
function _formatRorSummary(points = [], limit = 30) {
    return _normalizeRorPoints(points).slice(0, limit).map(point =>
        `${point.time}: BT=${point.bt}°C, ROR=${point.ror === '' ? '未計算' : `${point.ror}°C/min`}`
    ).join('；');
}

/** 從曲線提取可解釋的特徵，供提示詞與 API 失敗時的批次化備援文案使用。 */
function _getRoastCurveMetrics(points = []) {
    const normalized = _normalizeRorPoints(points);
    const numeric = normalized.filter(point => point.ror !== '');
    if (numeric.length < 2) {
        return { hasData: false, count: numeric.length, trend: '觀測點不足' };
    }

    const rors = numeric.map(point => point.ror);
    const last = numeric[numeric.length - 1];
    const split = Math.max(2, Math.ceil(numeric.length * 0.35));
    const early = numeric.slice(0, split).map(point => point.ror);
    const late = numeric.slice(-split).map(point => point.ror);
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const peakRor = Math.max(...rors);
    const lowRor = Math.min(...rors);
    const earlyAverage = average(early);
    const lateAverage = average(late);
    const lateNegative = late.some(value => value < 0);
    const lateRise = lateAverage > earlyAverage + 1.5;
    const decline = lateAverage < earlyAverage - 1.0;

    let trend = 'ROR 緩降';
    if (lateNegative || last.ror < 0) trend = '尾段失速並轉負';
    else if (lateRise) trend = '尾段回升，熱能略回彈';
    else if (decline && last.ror <= 4) trend = 'ROR 平順收斂';
    else if (last.ror >= 8) trend = '尾段熱能偏高';
    else if (decline) trend = 'ROR 穩定下降';

    return {
        hasData: true,
        count: numeric.length,
        peakRor,
        lowRor,
        finalRor: last.ror,
        earlyAverage,
        lateAverage,
        lateNegative,
        lateRise,
        decline,
        trend,
    };
}

/**
 * 以可重現的規則計算 ROR 品質分數（0-100），供首頁挑選同品種代表批次。
 * 這不是杯測分數，而是依曲線收斂、尾段失速/回升與 DTR/失重資料估算。
 */
function calculateRORQualityScore(roastData = {}) {
    const points = Array.isArray(roastData) ? roastData : (roastData.rorPoints || roastData.rorDatapoints || []);
    const metrics = _getRoastCurveMetrics(points);
    if (!metrics.hasData) return 0;

    let score = 60;
    if (metrics.lateNegative || metrics.finalRor < 0) score -= 35;
    if (metrics.lateRise) score -= 20;
    if (metrics.finalRor > 8) score -= 15;
    score += Math.max(0, 18 - Math.abs(metrics.finalRor - 4) * 3);
    if (metrics.decline && !metrics.lateNegative) score += 7;

    const dtr = parseFloat(roastData.dtr ?? roastData.dtrRatio ?? '');
    if (Number.isFinite(dtr)) {
        if (dtr >= 13 && dtr <= 18) score += 5;
        else if (dtr < 10 || dtr > 22) score -= 8;
    }
    const loss = parseFloat(roastData.lossRatio ?? '');
    if (Number.isFinite(loss)) {
        if (loss >= 9 && loss <= 16) score += 3;
        else if (loss < 7 || loss > 19) score -= 5;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
}

/** 將 ROR 曲線轉成短而可讀的批次風味方向，避免 AI 只回傳換數字的制式句。 */
function _getBatchFlavorCues(metrics) {
    if (!metrics.hasData) return { top: '待補曲線', mid: '待補曲線', base: '待補曲線' };
    if (metrics.lateNegative || metrics.finalRor < 0) {
        return { top: '熟果可可', mid: '焦糖麥芽', base: '收斂偏乾' };
    }
    if (metrics.lateRise || metrics.finalRor >= 8) {
        return { top: '明亮果汁', mid: '莓果酸甜', base: '茶感清脆' };
    }
    if (metrics.decline && metrics.finalRor <= 3) {
        return { top: '花果通透', mid: '蜜甜凝聚', base: '茶感悠長' };
    }
    if (metrics.decline) {
        return { top: '熟果花蜜', mid: '圓潤甜感', base: '可可回甘' };
    }
    return { top: '果香明亮', mid: '甜感展開', base: '尾韻持續' };
}

/** ROR 診斷固定保留由實際曲線推導的焦點，再疊加 AI 的自然語句。 */
function _getBatchRorFocus(metrics) {
    if (!metrics.hasData) return 'ROR 觀測點不足，暫不判定曲線品質';
    if (metrics.lateNegative || metrics.finalRor < 0) return '尾段失速轉負，熱能斷點是本批次首要問題';
    if (metrics.lateRise || metrics.finalRor >= 8) return '尾段熱能回彈，降火銜接仍需加強';
    if (metrics.decline && metrics.finalRor <= 4) return '前段熱能逐步收斂，尾段下降完整而穩定';
    if (metrics.decline) return 'ROR 持續下降但收斂較慢，中後段甜感仍有發展空間';
    return '中後段 ROR 未充分收斂，需留意熱能延續與下豆節點';
}

function _appendBatchCue(note, cue) {
    const text = String(note || '').trim();
    return text && text.includes(cue) ? text : `${text || '本批次風味'}｜${cue}`;
}

function _applyBatchFlavorCues(result, metrics) {
    const cues = _getBatchFlavorCues(metrics);
    return {
        ...result,
        topNote: _appendBatchCue(result.topNote, cues.top),
        midNote: _appendBatchCue(result.midNote, cues.mid),
        baseNote: _appendBatchCue(result.baseNote, cues.base)
    };
}

function _buildFlavorFallback(beanData) {
    const {
        name = '精品咖啡', origin = '精選產區', process = '精選處理法',
        roastLevel = '淺焙', roastDate = '', rorPoints = []
    } = beanData;
    const metrics = _getRoastCurveMetrics(rorPoints);

    let topNote = '白花、柑橘與細緻茶香';
    let midNote = '水蜜桃汁、蜂蜜柔甜';
    let baseNote = '白茶回甘、乾淨悠長';
    if (metrics.hasData && (metrics.lateNegative || metrics.finalRor < 0)) {
        topNote = '熟果、可可與木質暖香';
        midNote = '焦糖堅果、圓潤麥芽甜感';
        baseNote = '烘烤可可、尾韻收斂偏乾';
    } else if (metrics.hasData && (metrics.lateRise || metrics.finalRor >= 8)) {
        topNote = '柑橘、紅莓與明亮花香';
        midNote = '多汁莓果、蔗糖酸甜';
        baseNote = '茶感清晰、尾韻俐落回甘';
    } else if (metrics.hasData && metrics.finalRor > 4) {
        topNote = '熟果、花蜜與葡萄香';
        midNote = '葡萄果汁、焦糖甜感';
        baseNote = '可可堅果、圓潤回甘';
    }

    const curveNote = metrics.hasData
        ? `本批次 ROR 最高 ${metrics.peakRor.toFixed(1)}，出豆前為 ${metrics.finalRor.toFixed(1)}°C/min，曲線呈現「${metrics.trend}」`
        : '目前尚無足夠 ROR 觀測點，先以基本批次資料建立風味輪廓';
    const batchNote = roastDate ? `（${roastDate} 批次）` : '';
    return {
        topNote,
        midNote,
        baseNote,
        storyCopy: `這是${origin}的${name}${batchNote}，採${process}並以${roastLevel}完成。${curveNote}，職人據此保留前段香氣、調整中段甜感與尾韻質地。待咖啡冷卻後細品，感受這一批次獨有的風土轉折。`,
        brewTip: '建議水溫 88°C - 92°C，中偏粗研磨'
    };
}

function _buildRorDiagnosisFallback(roastData) {
    const { rorPoints = [], dtr = '', lossRatio = '' } = roastData;
    const metrics = _getRoastCurveMetrics(rorPoints);
    const dtrNum = parseFloat(dtr);
    const lossNum = parseFloat(lossRatio);
    const dtrEval = Number.isFinite(dtrNum)
        ? (dtrNum >= 20 ? `DTR ${dtrNum.toFixed(1)}%，發展偏長，風味會更圓潤` : dtrNum <= 13 ? `DTR ${dtrNum.toFixed(1)}%，發展偏短，花香較通透` : `DTR ${dtrNum.toFixed(1)}%，落在平衡區間`)
        : 'DTR 尚未提供，無法判斷發展長度';
    const lossEval = Number.isFinite(lossNum)
        ? `失重 ${lossNum.toFixed(1)}%，可作為本批次熟度基準`
        : '失重率尚未提供，請補登入豆與出豆重量';

    let rorTrend = 'ROR 觀測點不足，請補登至少兩個含豆溫的節點';
    let suggestion = ['補齊完整 ROR 觀測點', '記錄一爆與出豆時間', '下批次持續比對曲線'];
    let badge = '待補足曲線';
    if (metrics.hasData) {
        rorTrend = `${metrics.trend}（最高 ${metrics.peakRor.toFixed(1)}，出豆前 ${metrics.finalRor.toFixed(1)}°C/min）`;
        if (metrics.lateNegative || metrics.finalRor < 0) {
            suggestion = ['一爆前保留更多熱能', '降低過早降火造成的失速', '縮短低 ROR 停留時間'];
            badge = '尾段熱能不足';
        } else if (metrics.lateRise || metrics.finalRor >= 8) {
            suggestion = ['提前分段降火煞車', '一爆前降低熱能回彈', '維持尾段 ROR 緩降'];
            badge = '尾段熱能偏高';
        } else if (metrics.finalRor <= 4 && metrics.decline) {
            suggestion = ['保持目前平順收斂', '微調一爆後風門排煙', '以杯測確認甜感厚度'];
            badge = '曲線收斂漂亮';
        } else {
            suggestion = ['觀察一爆前 ROR 峰值', '分段降火避免尾段回升', '以杯測回饋微調 DTR'];
            badge = '熱能控制穩健';
        }
    }

    const score = metrics.hasData && !metrics.lateNegative && metrics.finalRor >= 0 && metrics.finalRor <= 8
        ? '良好' : metrics.hasData ? '需改善' : '良好';
    return { overallScore: score, dtrEval, lossEval, rorTrend, suggestion, badge };
}

/**
 * 產生快取 Key（根據豆款核心特徵）
 * @param {Object} beanData
 * @returns {string}
 */
function _buildCacheKey(beanData = {}) {
    const cacheData = { ...beanData };
    delete cacheData.bypassCache;
    if (cacheData.rorPoints) cacheData.rorPoints = _normalizeRorPoints(cacheData.rorPoints);
    const sig = JSON.stringify(_stableCacheValue({ version: CACHE_KEY_VERSION, data: cacheData }));
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
 * @param {string} [beanData.roastDate] - 烘焙日期
 * @param {string} [beanData.batchId] - 批次識別碼
 * @param {Array} [beanData.rorPoints] - 本批次完整 ROR 曲線
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
        roastDate = "",
        rorPoints = [],
        bypassCache = false
    } = beanData;

    const normalizedRorPoints = _normalizeRorPoints(rorPoints);
    const rorSummary = _formatRorSummary(normalizedRorPoints);
    const curveMetrics = _getRoastCurveMetrics(normalizedRorPoints);
    const batchFlavorCues = _getBatchFlavorCues(curveMetrics);

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
烘焙日期：${roastDate || "未提供"}
本批次完整 ROR 曲線（請以這些數據為主要依據）：${rorSummary || "暫無數據"}
曲線特徵摘要：${curveMetrics.hasData ? `最高 ROR ${curveMetrics.peakRor.toFixed(1)}、最低 ROR ${curveMetrics.lowRor.toFixed(1)}、出豆前 ROR ${curveMetrics.finalRor.toFixed(1)}、判讀為${curveMetrics.trend}` : "觀測點不足"}
ROR 導出的本批次風味方向（必須反映在三段風味中）：初韻「${batchFlavorCues.top}」、中調「${batchFlavorCues.mid}」、尾韻「${batchFlavorCues.base}」

請只根據「本批次」資料生成，不要沿用其他批次的固定文案；即使豆款相同，也要讓風味與故事反映本批次 ROR、DTR、失重率及烘焙日期的差異。請嚴格按照指定 JSON 格式輸出，不要有任何其他文字。`;

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
        const fallback = _buildFlavorFallback({ ...beanData, name, origin, process, roastLevel, roastDate, rorPoints: normalizedRorPoints });

        const result = {
            topNote:   parsed.topNote   || fallback.topNote,
            midNote:   parsed.midNote   || fallback.midNote,
            baseNote:  parsed.baseNote  || fallback.baseNote,
            storyCopy: parsed.storyCopy || fallback.storyCopy,
            brewTip:   parsed.brewTip   || "建議水溫 88°C - 92°C，中偏粗研磨"
        };
        const batchAwareResult = _applyBatchFlavorCues(result, curveMetrics);

        // ── 寫入快取 ──
        _writeCache(cacheKey, batchAwareResult);
        console.log(`[AI Cache WRITE] ${name} · ${origin}`);

        return batchAwareResult;

    } catch (err) {
        console.error("[AI Engine] Groq API 呼叫失敗:", err);
        return _applyBatchFlavorCues(
            _buildFlavorFallback({ ...beanData, name, origin, process, roastLevel, roastDate, rorPoints: normalizedRorPoints }),
            curveMetrics
        );
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
 * @param {string} [roastData.roastDate] - 烘焙日期
 * @param {string} [roastData.origin] - 產區
 * @param {string} [roastData.process] - 處理法
 * @param {string} [roastData.machine] - 烘豆機型
 */
async function generateRORDiagnosis(roastData) {
    const { rorPoints = [], dtr = "", lossRatio = "", beanName = "", roastLevel = "",
            roastDate = "", origin = "", process = "", machine = "" } = roastData;

    const normalizedRorPoints = _normalizeRorPoints(rorPoints);
    const rorSummary = _formatRorSummary(normalizedRorPoints);
    const curveMetrics = _getRoastCurveMetrics(normalizedRorPoints);

    const diagPrompt = `你是 SCA 認證烘焙師，請診斷以下「${beanName}」的烘焙數據，並給出職人改善建議。

烘焙度目標：${roastLevel}
發展時間比（DTR）：${dtr}
失重比：${lossRatio}
產區：${origin || "未提供"}；處理法：${process || "未提供"}；烘豆機：${machine || "未提供"}
烘焙日期：${roastDate || "未提供"}
完整 ROR 觀測數據（按時間）：${rorSummary || "暫無數據"}
曲線特徵摘要：${curveMetrics.hasData ? `最高 ${curveMetrics.peakRor.toFixed(1)}、最低 ${curveMetrics.lowRor.toFixed(1)}、出豆前 ${curveMetrics.finalRor.toFixed(1)}°C/min，${curveMetrics.trend}` : "觀測點不足"}
曲線判讀焦點（必須優先說明）：${_getBatchRorFocus(curveMetrics)}

請用 JSON 輸出（繁體中文）：
{
    "overallScore": "優秀/良好/需改善",
    "dtrEval": "DTR 評價（一句話）",
    "lossEval": "失重比評價（一句話）",
    "rorTrend": "ROR 走勢分析（一句話）",
    "suggestion": ["下批次改善建議（每點15字內）", "第二點建議", "第三點建議"],
    "badge": "本批次特色評語（10字以內，如「焦糖化完美」「花香保留極優」）"
}
請務必依據完整曲線與本批次數值判斷，不要套用固定的「ROR 曲線正常下降」或固定建議。`;

    try {
        const response = await fetch(GROQ_CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: GROQ_CONFIG.model,
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
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        const fallback = _buildRorDiagnosisFallback({ ...roastData, rorPoints: normalizedRorPoints });
        const batchFocus = _getBatchRorFocus(curveMetrics);
        const aiTrend = typeof parsed.rorTrend === 'string' ? parsed.rorTrend.trim() : '';
        return {
            ...fallback,
            ...parsed,
            // 強制保留曲線計算出的批次焦點，避免所有批次只套同一個 AI 句型。
            rorTrend: aiTrend && aiTrend !== fallback.rorTrend ? `${batchFocus}；${aiTrend}` : batchFocus
        };

    } catch (err) {
        console.error("[AI Engine] ROR 診斷失敗:", err);
        return {
            ..._buildRorDiagnosisFallback({ ...roastData, rorPoints: normalizedRorPoints }),
            rorTrend: _getBatchRorFocus(curveMetrics)
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
            dtrRatio = "", lossRatio = "", flavorTop = "", flavorMid = "", flavorBase = "",
            roastDate = "", batchId = "", rorPoints = [] } = recData;

    // 檢查快取：同豆款不同日期、批次或 ROR 曲線不可共用同一份筆記。
    const cacheKey = _buildCacheKey({
        name: beanName + '_obsidian', origin, process, roastLevel, roastDate, batchId,
        dtrRatio, lossRatio, flavorTop, flavorMid, flavorBase, rorPoints
    });
    const cached = _readCache(cacheKey);
    if (cached) return cached;

    const poetryPrompt = `你是「金成淬」精品咖啡品牌的詩意文案師與 SCA 品鑑師。
請根據以下這批次烘焙資料，生成一份適合收錄進職人筆記的文學性品鑑段落。

豆款：${beanName}（${origin}）
處理法：${process} ‧ 烘焙度：${roastLevel}
DTR：${dtrRatio} ‧ 失重：${lossRatio}
已知風味輪廓：${[flavorTop, flavorMid, flavorBase].filter(Boolean).join('、') || '待評鑑'}
烘焙日期：${roastDate || '未提供'}
完整 ROR 曲線：${_formatRorSummary(rorPoints) || '暫無數據'}

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
    calculateRORQualityScore,
    typewriterFill,
    showAILoading,
    hideAILoading,
    verifyPasswordSecure,
    clearAICache,
    endpoint: GROQ_CONFIG.endpoint,
    isKeyReady: () => true
    // PASSWORD_HASH 已從前端移除，改由 Cloudflare Worker 伺服器端保管
};
