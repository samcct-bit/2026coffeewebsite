/**
 * 金成淬精品咖啡 · AI 引擎模組
 * Groq LLM API 整合 · 品牌一致性風味文案生成
 * Version: 3.0 | 2026-09-01
 * Key Source: C:\2026_key\groq_coffeewebsite.txt
 */

// ──────────────────────────────────────────────
// API 中繼層：改由 Cloudflare Workers 代理，不再儲存金鑰於前端
// ──────────────────────────────────────────────


const GROQ_CONFIG = {
    model: "openai/gpt-oss-120b",
    researchModel: "groq/compound-mini",
    endpoint: "https://gsk-groq-proxy.gansingkim.workers.dev", // ← 請在部署後將此替換為您的 Cloudflare Worker 網址
    maxTokens: 1200,
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
    "topNote": "初韻香氣，最多13字（包含全形頓號「、」），用「、」分隔2-3種具體香氣意象",
    "midNote": "中調風味，最多13字（包含全形頓號「、」），強調果汁感／甜感／口感層次",
    "baseNote": "尾韻，最多13字（包含全形頓號「、」），強調回甘／餘韻／尾段印象",
    "storyCopy": "90-130字品牌故事文案，融入具體風土地理、烘焙工藝細節、金成淬職人精神，結尾帶出邀請品飲的情境。",
    "brewTip": "沖煮建議一句話，包含水溫範圍與研磨度建議（20字以內）"
}

【風格禁忌】：
- 禁用：香甜、好喝、濃郁（太平庸）
- 禁用：英文夾雜（除非是品種或技術名詞）
- 禁用：過度堆疊感嘆號

【風格範例（需依資料選用，不可固定套用）】：
- 衣索比亞水洗可寫：「茉莉、佛手柑皮」
- 肯亞水洗可寫：「黑醋栗、葡萄柚」
- 巴西日曬可寫：「烤榛果、黃梅」
- 印尼濕剝可寫：「雪松、暖香料」
- 壞：「花香四溢」「非常香」「晨露般高雅果香」`;

// ──────────────────────────────────────────────
// localStorage 快取層（同一批次不重複呼叫 API）
// ──────────────────────────────────────────────
const CACHE_PREFIX = '_gskai_cache_';
const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72 小時 TTL（改用 localStorage 跨分頁保留）
const CACHE_KEY_VERSION = 'web-calibrated-v6';
const RESEARCH_CACHE_PREFIX = '_gskai_green_research_';
const RESEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESEARCH_SCHEMA_VERSION = 'green-reference-v1';

// 產區、處理法與品種只提供「合理候選」，避免把風土先驗寫成不存在的杯測事實。
// 排列順序同時用於離線 fallback，因此不同來源在 API 失敗時也不會落回同一組文案。
const SENSORY_ORIGIN_PROFILES = [
    { match: /衣索比亞|埃塞俄比亞|ethiopia|耶加雪菲|yirgacheffe|古吉|guji|西達摩|sidamo|罕貝拉|hambela/i,
      label: '衣索比亞高地', top: ['茉莉', '佛手柑', '檸檬花'], mid: ['白桃', '杏桃', '藍莓'], base: ['白茶', '蜂蜜', '柑橘皮'] },
    { match: /肯亞|kenya|尼亞里|nyeri|奇安布|kiambu|麒麟雅嘉|kirinyaga/i,
      label: '肯亞高地', top: ['黑醋栗', '葡萄柚', '洛神花'], mid: ['紅李', '蔓越莓', '甘蔗汁'], base: ['烏梅', '紅茶', '可可碎粒'] },
    { match: /哥倫比亞|colombia|薇拉|huila|考卡|cauca|娜玲瓏|nari[oñ]o/i,
      label: '哥倫比亞安地斯', top: ['紅蘋果', '黃柑', '梅子'], mid: ['蜜桃', '紅莓', '蔗糖'], base: ['黑糖', '可可', '核果'] },
    { match: /哥斯大黎加|costa rica|塔拉珠|tarraz[uú]/i,
      label: '哥斯大黎加火山產區', top: ['橙花', '脆蘋果', '杏桃'], mid: ['黃桃', '葡萄', '蜂蜜'], base: ['焦糖', '榛果', '柑橘皮'] },
    { match: /巴拿馬|panama|波魁特|boquete|翡翠莊園|geisha estates?/i,
      label: '巴拿馬高地', top: ['茉莉', '橙花', '佛手柑'], mid: ['白桃', '甜橙', '香檳葡萄'], base: ['伯爵茶', '蜂蜜', '柚皮'] },
    { match: /泰國|thailand|清萊|chiang rai/i,
      label: '泰北高地', top: ['香料', '紅棗', '烤堅果'], mid: ['龍眼蜜', '熟李', '黑糖'], base: ['可可', '烏龍茶', '木質香'] },
    { match: /巴西|brazil|喜拉朵|cerrado|米納斯|minas/i,
      label: '巴西產區', top: ['烤榛果', '黃梅', '牛奶巧克力'], mid: ['焦糖', '熟莓', '奶油'], base: ['可可', '杏仁', '太妃糖'] },
    { match: /瓜地馬拉|guatemala|安提瓜|antigua/i,
      label: '瓜地馬拉火山產區', top: ['紅蘋果', '橙皮', '烘烤香料'], mid: ['黑莓', '焦糖', '李子'], base: ['可可', '杏仁', '紅茶'] },
    { match: /印尼|indonesia|蘇門答臘|sumatra|曼特寧|mandheling/i,
      label: '印尼群島', top: ['雪松', '香料', '熟果'], mid: ['黑糖', '黑莓', '草本'], base: ['黑巧克力', '木質香', '菸草'] }
];

const SENSORY_PROCESS_PROFILES = [
    { match: /厭氧|anaerobic|無氧|co2|二氧化碳/i, label: '厭氧發酵', mid: ['酒香果汁感', '飽滿熟果'], base: ['香料甜韻', '發酵尾韻'] },
    { match: /水洗|washed|wet process/i, label: '水洗', mid: ['柑橘酸質', '蔗糖甜感'], base: ['乾淨茶感', '俐落回甘'] },
    { match: /日曬|natural|dry process/i, label: '日曬', mid: ['熟果甜感', '果醬質地'], base: ['可可甜韻', '發酵果香'] },
    { match: /蜜處理|honey/i, label: '蜜處理', mid: ['蜂蜜甜感', '糖漿質地'], base: ['焦糖回甘', '圓潤甜韻'] },
    { match: /濕剝|wet hulled|giling basah/i, label: '濕剝', mid: ['草本甜感', '厚實口感'], base: ['木質辛香', '深沉可可'] }
];

const SENSORY_VARIETY_PROFILES = [
    { match: /藝伎|瑰夏|geisha|gesha/i, label: 'Gesha', notes: ['茉莉', '佛手柑', '白桃', '茶感'] },
    { match: /sl\s*28|sl\s*34/i, label: 'SL28／SL34', notes: ['黑醋栗', '葡萄柚', '紅李', '甘蔗'] },
    { match: /粉紅波旁|pink bourbon/i, label: '粉紅波旁', notes: ['玫瑰', '粉紅葡萄柚', '紅莓', '蔗糖'] },
    { match: /卡杜拉|caturra/i, label: 'Caturra', notes: ['紅蘋果', '柑橘', '焦糖'] },
    { match: /卡杜艾|catuai/i, label: 'Catuai', notes: ['黃果', '堅果', '焦糖'] },
    { match: /波旁|bourbon/i, label: 'Bourbon', notes: ['核果', '柑橘', '蔗糖'] }
];

const GENERIC_ORIGIN_PROFILE = {
    label: '未辨識產區', top: ['橙皮', '紅蘋果', '淡雅花香'],
    mid: ['核果', '蔗糖', '柔和果酸'], base: ['焦糖', '可可', '茶感']
};

function _findSensoryProfile(value, profiles, fallback = null) {
    const text = String(value || '').trim();
    return profiles.find(profile => profile.match.test(text)) || fallback;
}

function _buildSensoryContext(beanData = {}) {
    const identity = [beanData.name, beanData.origin].filter(Boolean).join(' ');
    const origin = _findSensoryProfile(identity, SENSORY_ORIGIN_PROFILES, GENERIC_ORIGIN_PROFILE);
    const process = _findSensoryProfile(beanData.process, SENSORY_PROCESS_PROFILES);
    const variety = _findSensoryProfile([beanData.name, beanData.variety].filter(Boolean).join(' '), SENSORY_VARIETY_PROFILES);
    return { origin, process, variety };
}

function _formatSensoryContext(context) {
    const lines = [
        `產區候選（${context.origin.label}）：初韻 ${context.origin.top.join('／')}；中調 ${context.origin.mid.join('／')}；尾韻 ${context.origin.base.join('／')}`
    ];
    if (context.variety) lines.push(`品種候選（${context.variety.label}）：${context.variety.notes.join('／')}`);
    if (context.process) lines.push(`處理法修飾（${context.process.label}）：中調 ${context.process.mid.join('／')}；尾韻 ${context.process.base.join('／')}`);
    return lines.join('\n');
}

function _hashText(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(31, hash) + text.charCodeAt(index) | 0;
    }
    return Math.abs(hash).toString(36);
}

function _asStringArray(value, limit = 12) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[、，,／/；;|]/);
    return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))].slice(0, limit);
}

function _extractJsonObject(content) {
    const text = String(content || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('研究模型未回傳 JSON');
    return JSON.parse(text.slice(start, end + 1));
}

function _collectResearchSources(message, preferredUrl = '') {
    const candidates = [];
    const tools = Array.isArray(message?.executed_tools) ? message.executed_tools : [];
    tools.forEach(tool => {
        const searchResults = tool?.search_results?.results || tool?.search_results || [];
        if (Array.isArray(searchResults)) candidates.push(...searchResults);
    });
    if (preferredUrl) candidates.unshift({ title: '使用者提供的生豆來源', url: preferredUrl, score: 1 });

    const seen = new Set();
    return candidates.reduce((sources, item) => {
        const url = String(item?.url || '').trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url) || sources.length >= 6) return sources;
        seen.add(url);
        sources.push({
            title: String(item?.title || '生豆資料來源').trim().slice(0, 120),
            url,
            score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
        });
        return sources;
    }, []);
}

function _normalizeResearchBundle(value = {}, beanData = {}) {
    const allowedConfidence = ['high', 'medium', 'low', 'none'];
    const confidence = allowedConfidence.includes(value.confidence) ? value.confidence : 'none';
    const sources = (Array.isArray(value.sources) ? value.sources : []).reduce((items, source) => {
        const url = String(source?.url || '').trim();
        if (!/^https?:\/\//i.test(url) || items.some(item => item.url === url) || items.length >= 6) return items;
        items.push({
            title: String(source?.title || '生豆資料來源').trim().slice(0, 120),
            url,
            score: Number.isFinite(Number(source?.score)) ? Number(source.score) : null
        });
        return items;
    }, []);
    return {
        schemaVersion: RESEARCH_SCHEMA_VERSION,
        confidence,
        matchedName: String(value.matchedName || value.matchedIdentity?.name || '').trim(),
        matchedOrigin: String(value.matchedOrigin || value.matchedIdentity?.origin || '').trim(),
        matchedProcess: String(value.matchedProcess || value.matchedIdentity?.process || '').trim(),
        matchedVariety: String(value.matchedVariety || value.matchedIdentity?.variety || '').trim(),
        matchedCropYear: String(value.matchedCropYear || value.matchedIdentity?.cropYear || '').trim(),
        referenceTop: _asStringArray(value.referenceTop || value.topNotes, 6),
        referenceMid: _asStringArray(value.referenceMid || value.midNotes, 6),
        referenceBase: _asStringArray(value.referenceBase || value.baseNotes, 6),
        descriptors: _asStringArray(value.descriptors || value.allDescriptors, 16),
        structuralNotes: _asStringArray(value.structuralNotes, 8),
        rawCuppingNotes: String(value.rawCuppingNotes || beanData.supplierCuppingNotes || '').trim().slice(0, 800),
        conflicts: _asStringArray(value.conflicts, 8),
        summary: String(value.summary || '').trim().slice(0, 600),
        sources,
        researchedAt: value.researchedAt || new Date().toISOString(),
        researchModel: value.researchModel || GROQ_CONFIG.researchModel
    };
}

function _buildResearchCacheKey(beanData = {}) {
    const identity = {
        version: RESEARCH_SCHEMA_VERSION,
        name: beanData.name || '',
        origin: beanData.origin || '',
        process: beanData.process || '',
        altitude: beanData.altitude || '',
        variety: beanData.variety || '',
        cropYear: beanData.cropYear || '',
        sourceUrl: beanData.greenBeanSourceUrl || '',
        supplierNotes: beanData.supplierCuppingNotes || ''
    };
    return RESEARCH_CACHE_PREFIX + _hashText(JSON.stringify(_stableCacheValue(identity)));
}

function _readResearchCache(cacheKey) {
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (!entry?.data || Date.now() - entry.ts > RESEARCH_CACHE_TTL_MS) {
            localStorage.removeItem(cacheKey);
            return null;
        }
        return entry.data;
    } catch {
        return null;
    }
}

function _writeResearchCache(cacheKey, data) {
    try {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch {
        // 研究快取失敗不應阻擋主要風味生成。
    }
}

function _buildManualResearch(beanData) {
    const notes = String(beanData.supplierCuppingNotes || '').trim();
    if (!notes) return null;
    return _normalizeResearchBundle({
        confidence: 'high',
        matchedName: beanData.name,
        matchedOrigin: beanData.origin,
        matchedProcess: beanData.process,
        matchedVariety: beanData.variety,
        matchedCropYear: beanData.cropYear,
        descriptors: _asStringArray(notes, 16),
        rawCuppingNotes: notes,
        summary: '採用使用者輸入的供應商／生豆標籤杯測資料作為最高優先基準。',
        sources: /^https?:\/\//i.test(String(beanData.greenBeanSourceUrl || '').trim())
            ? [{ title: '使用者提供的生豆來源', url: beanData.greenBeanSourceUrl, score: 1 }]
            : [],
        researchModel: 'manual-supplier-reference'
    }, beanData);
}

async function researchGreenBeanProfile(beanData = {}) {
    if (beanData.greenBeanResearch?.schemaVersion === RESEARCH_SCHEMA_VERSION && !beanData.refreshResearch) {
        return _normalizeResearchBundle(beanData.greenBeanResearch, beanData);
    }

    const manualResearch = _buildManualResearch(beanData);
    if (manualResearch) return manualResearch;

    const cacheKey = _buildResearchCacheKey(beanData);
    if (!beanData.refreshResearch) {
        const cached = _readResearchCache(cacheKey);
        if (cached) return _normalizeResearchBundle(cached, beanData);
    }

    const name = String(beanData.name || '').trim();
    const origin = String(beanData.origin || '').trim();
    const process = String(beanData.process || '').trim();
    if (!name || !origin || !process) {
        return _normalizeResearchBundle({
            confidence: 'none',
            conflicts: ['缺少豆名、產區或處理法，未執行網路比對'],
            summary: '資料不足，僅能使用保守的產區候選。'
        }, beanData);
    }

    const researchPrompt = `你是精品咖啡生豆資料研究員。請使用網路搜尋，尋找與下列生豆「精準相符」的供應商、生豆進口商、莊園或烘豆商產品資料，整理原始杯測描述。\n\n生豆名稱：${name}\n產區：${origin}\n處理法：${process}\n海拔：${beanData.altitude || '未提供'}\n品種：${beanData.variety || '未提供'}\n產季：${beanData.cropYear || '未提供'}\n優先來源網址：${beanData.greenBeanSourceUrl || '未提供'}\n\n規則：\n1. 必須比對莊園／處理站、處理法、品種與產季；不可只用國家通用風味冒充精準資料。\n2. high 代表名稱與處理法等核心欄位精準相符；medium 代表同莊園與處理法但產季或次要欄位未確認；low 代表只有部分名稱或產區相符；找不到則 none。\n3. 若網路資料和輸入的處理法、品種、海拔衝突，逐條寫入 conflicts，不要自行修正輸入。\n4. 風味詞保留來源的具體名詞，不要自行補寫花香、莓果、柑橘等詞。\n5. 只輸出一個可解析的 JSON 物件，不要 markdown 或說明文字。\n\nJSON 格式：\n{\n  "confidence":"high|medium|low|none",\n  "matchedName":"",\n  "matchedOrigin":"",\n  "matchedProcess":"",\n  "matchedVariety":"",\n  "matchedCropYear":"",\n  "referenceTop":["入口香氣詞"],\n  "referenceMid":["中段滋味詞"],\n  "referenceBase":["尾韻詞"],\n  "descriptors":["全部來源風味詞"],\n  "structuralNotes":["酸質、甜感、口感、乾淨度等來源描述"],\n  "conflicts":["欄位衝突"],\n  "summary":"100字內的比對依據"\n}`;

    try {
        const response = await fetch(GROQ_CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: GROQ_CONFIG.researchModel,
                messages: [{ role: 'user', content: researchPrompt }],
                max_completion_tokens: 1200,
                citation_options: 'enabled',
                search_settings: { country: 'tw' }
            })
        });
        if (!response.ok) throw new Error(`生豆研究 API 錯誤 ${response.status}`);

        const data = await response.json();
        const message = data.choices?.[0]?.message || {};
        const parsed = _extractJsonObject(message.content);
        const sources = _collectResearchSources(message, beanData.greenBeanSourceUrl);
        if (!sources.length && ['high', 'medium'].includes(parsed.confidence)) parsed.confidence = 'low';
        const research = _normalizeResearchBundle({
            ...parsed,
            sources,
            researchedAt: new Date().toISOString(),
            researchModel: GROQ_CONFIG.researchModel
        }, beanData);
        _writeResearchCache(cacheKey, research);
        return research;
    } catch (error) {
        console.warn('[AI Research] 生豆網路校正失敗，改用保守候選：', error);
        return _normalizeResearchBundle({
            confidence: 'none',
            conflicts: [`網路校正失敗：${error.message}`],
            summary: '網路研究不可用，本次不引用未驗證的具體生豆資料。'
        }, beanData);
    }
}

function _formatResearchForPrompt(research) {
    if (!research || research.confidence === 'none') return '沒有可驗證的精準生豆來源；請採保守描述。';
    const sourceLines = (research.sources || []).map(source => `- ${source.title}：${source.url}`).join('\n');
    return `比對可信度：${research.confidence}\n匹配豆款：${research.matchedName || '未確認'}\n匹配產區／處理法／品種：${research.matchedOrigin || '未確認'}／${research.matchedProcess || '未確認'}／${research.matchedVariety || '未確認'}\n來源初韻：${research.referenceTop.join('、') || '未分段'}\n來源中調：${research.referenceMid.join('、') || '未分段'}\n來源尾韻：${research.referenceBase.join('、') || '未分段'}\n全部來源風味詞：${research.descriptors.join('、') || research.rawCuppingNotes || '未提供'}\n來源感官結構：${research.structuralNotes.join('、') || '未提供'}\n欄位衝突：${research.conflicts.join('；') || '無'}\n來源：\n${sourceLines || '- 無可驗證網址'}`;
}

function _getKnownConcreteFlavorTerms() {
    const originTerms = SENSORY_ORIGIN_PROFILES.flatMap(profile => [...profile.top, ...profile.mid, ...profile.base]);
    const processTerms = SENSORY_PROCESS_PROFILES.flatMap(profile => [...profile.mid, ...profile.base]);
    const varietyTerms = SENSORY_VARIETY_PROFILES.flatMap(profile => profile.notes);
    return [...new Set([
        ...originTerms,
        ...processTerms,
        ...varietyTerms,
        ...GENERIC_ORIGIN_PROFILE.top,
        ...GENERIC_ORIGIN_PROFILE.mid,
        ...GENERIC_ORIGIN_PROFILE.base
    ])].sort((a, b) => b.length - a.length);
}

function _isNoteGroundedInReference(note, research) {
    if (!['high', 'medium'].includes(research?.confidence)) return true;
    const references = _asStringArray([
        ...(research.referenceTop || []),
        ...(research.referenceMid || []),
        ...(research.referenceBase || []),
        ...(research.descriptors || []),
        ..._asStringArray(research.rawCuppingNotes, 20)
    ], 40);
    if (!references.length) return false;

    const text = String(note || '');
    const hasReferenceAnchor = references.some(term => text.includes(term));
    if (!hasReferenceAnchor) return false;

    const unauthorizedKnownTerm = _getKnownConcreteFlavorTerms().some(term =>
        text.includes(term) && !references.some(reference => reference.includes(term) || term.includes(reference))
    );
    return !unauthorizedKnownTerm;
}

function _groundFlavorResult(result, fallback, research) {
    if (!['high', 'medium'].includes(research?.confidence)) return result;
    return {
        ...result,
        topNote: _isNoteGroundedInReference(result.topNote, research) ? result.topNote : fallback.topNote,
        midNote: _isNoteGroundedInReference(result.midNote, research) ? result.midNote : fallback.midNote,
        baseNote: _isNoteGroundedInReference(result.baseNote, research) ? result.baseNote : fallback.baseNote
    };
}

const FLAVOR_NOTE_MAX_LENGTH = 13;

/** 將風味描述整理成適合標籤版面的短句，頓號也計入 13 字上限。 */
function _fitFlavorNote(value, fallback = '風味待確認') {
    let text = String(value ?? '')
        .replace(/[\r\n\t ]+/g, '')
        .replace(/[，,、／/|｜；;]+/g, '、')
        .replace(/[^\u3400-\u9fff、]/g, '')
        .replace(/^、+|、+$/g, '');
    if (!text) text = fallback;
    const parts = text.split('、').filter(Boolean);
    const fittedParts = [];
    for (const part of parts) {
        const candidate = fittedParts.length ? `${fittedParts.join('、')}、${part}` : part;
        if (Array.from(candidate).length > FLAVOR_NOTE_MAX_LENGTH) break;
        fittedParts.push(part);
    }
    if (!fittedParts.length) {
        return Array.from(parts[0] || fallback).slice(0, FLAVOR_NOTE_MAX_LENGTH).join('');
    }
    return fittedParts.join('、');
}

function _fitFlavorNotes(result) {
    return {
        ...result,
        topNote: _fitFlavorNote(result.topNote, '花香、果香'),
        midNote: _fitFlavorNote(result.midNote, '果汁、甜感'),
        baseNote: _fitFlavorNote(result.baseNote, '茶感、回甘')
    };
}

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

/**
 * ROR 僅能合理推估感官結構，不能單憑曲線判定莓果、柑橘等具體香氣。
 * 因此這裡只回傳明亮度、甜感、口感與尾韻狀態，具體香氣交由產區／品種／處理法決定。
 */
function _getBatchFlavorCues(metrics) {
    if (!metrics.hasData) return { top: '香氣強度待杯測', mid: '酸甜平衡待杯測', base: '尾韻質地待杯測' };
    if (metrics.lateNegative || metrics.finalRor < 0) {
        return { top: '香氣較收斂', mid: '熟甜與厚度提高', base: '收斂偏乾' };
    }
    if (metrics.lateRise || metrics.finalRor >= 8) {
        return { top: '香氣明亮直接', mid: '酸質活潑、甜感較薄', base: '尾韻短而俐落' };
    }
    if (metrics.decline && metrics.finalRor <= 3) {
        return { top: '香氣通透', mid: '甜感凝聚、口感輕盈', base: '乾淨悠長' };
    }
    if (metrics.decline) {
        return { top: '香氣完整', mid: '酸甜圓潤、質地平衡', base: '回甘穩定' };
    }
    return { top: '香氣中等', mid: '甜感平穩、厚度中等', base: '尾韻持續' };
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

function _buildFlavorFallback(beanData) {
    const {
        name = '精品咖啡', origin = '精選產區', process = '精選處理法',
        roastLevel = '淺焙', roastDate = '', rorPoints = []
    } = beanData;
    const metrics = _getRoastCurveMetrics(rorPoints);
    const sensory = _buildSensoryContext(beanData);
    const research = beanData.greenBeanResearch;
    const useVerifiedReference = ['high', 'medium'].includes(research?.confidence);
    const descriptors = useVerifiedReference ? _asStringArray(research.descriptors, 12) : [];
    const processMid = sensory.process?.mid?.[0] || sensory.origin.mid[1];
    const processBase = sensory.process?.base?.[0] || sensory.origin.base[1];
    const topParts = useVerifiedReference
        ? [..._asStringArray(research.referenceTop, 2), ...descriptors].slice(0, 2)
        : [sensory.origin.top[0], sensory.variety?.notes?.[1] || sensory.origin.top[1]];
    const midParts = useVerifiedReference
        ? [..._asStringArray(research.referenceMid, 2), ...descriptors.slice(2)].slice(0, 2)
        : [sensory.origin.mid[0], processMid];
    const baseParts = useVerifiedReference
        ? [..._asStringArray(research.referenceBase, 2), ...descriptors.slice(4)].slice(0, 2)
        : [sensory.origin.base[0], processBase];
    const topNote = _fitFlavorNote((topParts.length ? topParts : sensory.origin.top.slice(0, 2)).join('、'), '花香、果香');
    const midNote = _fitFlavorNote((midParts.length ? midParts : [sensory.origin.mid[0], processMid]).join('、'), '果汁、甜感');
    const baseNote = _fitFlavorNote((baseParts.length ? baseParts : [sensory.origin.base[0], processBase]).join('、'), '茶感、回甘');

    const curveNote = metrics.hasData
        ? `本批次 ROR 最高 ${metrics.peakRor.toFixed(1)}，出豆前為 ${metrics.finalRor.toFixed(1)}°C/min，曲線呈現「${metrics.trend}」`
        : '目前尚無足夠 ROR 觀測點，先以基本批次資料建立風味輪廓';
    const batchNote = roastDate ? `（${roastDate} 批次）` : '';
    return {
        topNote,
        midNote,
        baseNote,
        storyCopy: `這是${origin}的${name}${batchNote}，採${process}並以${roastLevel}完成。${curveNote}，職人據此保留前段香氣、調整中段甜感與尾韻質地。待咖啡冷卻後細品，感受這一批次獨有的風土轉折。`,
        brewTip: '建議水溫 88°C - 92°C，中偏粗研磨',
        greenBeanResearch: research || null,
        referenceConfidence: research?.confidence || 'none',
        referenceSources: research?.sources || [],
        referenceConflicts: research?.conflicts || []
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

/** 取出近期已生成的風味，讓下一次生成能主動避開重複主詞。 */
function _getRecentFlavorExamples(excludeCacheKey = '', limit = 8) {
    try {
        const keys = [];
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key) keys.push(key);
        }
        return keys
            .filter(key => key.startsWith(CACHE_PREFIX) && key !== excludeCacheKey)
            .map(key => {
                try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
            })
            .filter(entry => entry?.data && Date.now() - entry.ts <= CACHE_TTL_MS)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, limit)
            .map(entry => [entry.data.topNote, entry.data.midNote, entry.data.baseNote].filter(Boolean).join('／'))
            .filter(Boolean);
    } catch {
        return [];
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
    const sensoryContext = _buildSensoryContext({ name, origin, process, variety });

    // ── 快取命中檢查 ──
    const cacheKey = _buildCacheKey(beanData);
    if (!bypassCache) {
        const cached = _readCache(cacheKey);
        if (cached) {
            console.log(`[AI Cache HIT] ${name} · ${origin}`);
            return _fitFlavorNotes(cached);
        }
    }

    const recentFlavorExamples = _getRecentFlavorExamples(cacheKey);
    const greenBeanResearch = await researchGreenBeanProfile({ ...beanData, name, origin, process, altitude, variety });
    const hasVerifiedReference = ['high', 'medium'].includes(greenBeanResearch.confidence);

    const userPrompt = `請根據以下咖啡生豆資料，生成金成淬品牌風格的三段式風味描述與品牌文案：

豆款名稱：${name}
產區：${origin}
處理法：${process}
烘焙度：${roastLevel}
${altitude ? `海拔：${altitude}` : ""}
${variety ? `品種：${variety}` : ""}
${beanData.cropYear ? `產季：${beanData.cropYear}` : ""}
${dtr ? `發展時間比 DTR：${dtr}（${parseFloat(dtr) >= 20 ? "發展較長：熟甜與厚度可能提高、酸質感可能降低" : parseFloat(dtr) <= 13 ? "發展較短：明亮度可能提高、厚度較輕，並需留意發展不足" : "發展比例居中，仍需結合曲線與杯測判斷"})` : ""}
${lossRatio ? `烘焙失重率：${lossRatio}` : ""}
烘豆設備：${machine}
烘焙日期：${roastDate || "未提供"}
本批次完整 ROR 曲線（請以這些數據為主要依據）：${rorSummary || "暫無數據"}
曲線特徵摘要：${curveMetrics.hasData ? `最高 ROR ${curveMetrics.peakRor.toFixed(1)}、最低 ROR ${curveMetrics.lowRor.toFixed(1)}、出豆前 ROR ${curveMetrics.finalRor.toFixed(1)}、判讀為${curveMetrics.trend}` : "觀測點不足"}

網路／供應商生豆校正資料（具體風味名詞的最高優先依據）：
${_formatResearchForPrompt(greenBeanResearch)}

風土與製程的合理候選（只有在生豆校正可信度為 low／none 時，才能保守補充）：
${_formatSensoryContext(sensoryContext)}

ROR 僅導出的感官結構：初韻「${batchFlavorCues.top}」、中調「${batchFlavorCues.mid}」、尾韻「${batchFlavorCues.base}」
${recentFlavorExamples.length ? `${hasVerifiedReference ? '近期其他批次描述只用於避免修辭重複；生豆來源確認的風味名詞可以保留，不得為追求不同而替換。' : '近期其他批次已使用的描述（非產區必要特徵不要重複）：'}\n- ${recentFlavorExamples.join('\n- ')}` : '目前沒有近期生成紀錄可供避重。'}

選詞優先序必須是：使用者供應商杯測筆記 ＞ high／medium 生豆校正資料 ＞ 品種與產區候選。當校正可信度為 high／medium 時，具體水果、花、香料、茶、可可等名詞必須取自校正資料，不可任意替換；ROR 只能調整明亮度、酸甜強弱、厚薄、乾淨度與尾韻，不得憑空創造任何具體香氣。若 conflicts 非空，故事不得把衝突欄位寫成事實。三段分別負責「入口香氣／中段滋味與質地／吞嚥後餘韻」，不要用晨露、高雅、明亮、清雅等形容詞假裝差異。資料不足時採保守描述。

【標籤版面硬性限制】topNote、midNote、baseNote 每一欄最多 13 個字元，包含全形頓號「、」在內；必須使用繁體中文，並以全形頓號分隔風味，禁止使用逗號、斜線或換行。若風味詞過長，請優先保留最具辨識度的 2-3 個短詞，確實控制在 13 字以內。

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
                max_completion_tokens: GROQ_CONFIG.maxTokens,
                temperature: GROQ_CONFIG.temperature,
                reasoning_effort: "low",
                reasoning_format: "hidden",
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
        const fallback = _buildFlavorFallback({ ...beanData, name, origin, process, roastLevel, roastDate, rorPoints: normalizedRorPoints, greenBeanResearch });

        const result = {
            topNote:   parsed.topNote   || fallback.topNote,
            midNote:   parsed.midNote   || fallback.midNote,
            baseNote:  parsed.baseNote  || fallback.baseNote,
            storyCopy: parsed.storyCopy || fallback.storyCopy,
            brewTip:   parsed.brewTip   || "建議水溫 88°C - 92°C，中偏粗研磨",
            greenBeanResearch,
            referenceConfidence: greenBeanResearch.confidence,
            referenceSources: greenBeanResearch.sources,
            referenceConflicts: greenBeanResearch.conflicts
        };
        const groundedResult = _groundFlavorResult(result, fallback, greenBeanResearch);
        const constrainedResult = _fitFlavorNotes(groundedResult);
        // ── 寫入快取 ──
        _writeCache(cacheKey, constrainedResult);
        console.log(`[AI Cache WRITE] ${name} · ${origin}`);

        return constrainedResult;

    } catch (err) {
        console.error("[AI Engine] Groq API 呼叫失敗:", err);
        return _fitFlavorNotes(_buildFlavorFallback({ ...beanData, name, origin, process, roastLevel, roastDate, rorPoints: normalizedRorPoints, greenBeanResearch }));
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
                max_completion_tokens: 800,
                temperature: 0.7,
                reasoning_effort: "low",
                reasoning_format: "hidden",
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
                max_completion_tokens: 800,
                temperature: 0.92,
                reasoning_effort: "low",
                reasoning_format: "hidden",
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
    const keys = [];
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(RESEARCH_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach(k => localStorage.removeItem(k));
    console.log(`[AI Cache] 已清除 ${keys.length} 筆快取`);
    return keys.length;
}

// 全域匯出
window.GansingKimAI = {
    generateCoffeeFlavorAI,
    researchGreenBeanProfile,
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
