# 單人杯測校準與公開頁視覺整合

## 本次狀態

2026-10-23，本機實作與驗證；尚未提交、推送、部署。正式版仍維持 `1d0d115`。原有四個未追蹤稽核／標籤提案檔案保留。使用者確認沒有焙色儀、通常單人杯測，因此本版不填造 Agtron、不以 AI 或曲線代替實測、不產生 SCA 百分制分數。

## 實際使用流程

1. 後台頂部、首頁「工作室管理工具」，或審核面板的「單人杯測與複測」進入 `cupping.html?id={batchId}`，沿用既有 Firebase 管理員登入。可測已發布批次或私有烘焙草稿，不能將未知 ID 改選為其他豆。
2. 新增場次，填寫日期、生豆 lot（可先用可追溯的內部批號）、磨豆機、刻度、用水、實際粉量、杯容量與注水溫度。11g／200mL／93°C 是可編輯的起始配方，必須確認實際條件；本工具不是自動量測設備。
3. 三杯分開研磨、沖煮；各杯記熱（適口）、溫、涼三輪的風味、口感、餘韻。原始描述每欄最多 300 字、不限於標籤的 13 字；品飲溫度及餘韻秒數選填。無法辨識就寫「未辨識」，不要求猜出水果。逐杯異常、個人喜好分開保留。
4. 儲存未完成紀錄可續填。完成全部觀察並核對條件後「鎖定」；鎖定不可修改或刪除，有修正另建新場次。開始時的既有文案只在鎖定後揭露，屬歷史文案參考，不假稱是已凍結的 AI 預測或完整盲測。
5. 選一場為「本批單人實測」，或不同日期的兩場為「單人複測」。兩場須同 lot、用水、磨豆機、刻度、配比，注水溫度差不超過 3°C。這是店內可比性規則，不是 SCA 認證門檻。
6. 候選詞採每場至少兩個獨立杯出現的相同詞；同杯三輪只算一杯。兩場時取共同詞。只統一 Unicode／空白，沒有同義詞模型或水果自動猜測；長句和不同措辭可能不會被自動辨識成同義。沒有共同詞就保留不確定性，不能讓 AI 補詞。異常杯仍須查閱，不以多數表決消除瑕疵紀錄。
7. 人工選取風味、口感、餘韻各 1～13 字（含頓號），核對後採用，只更新私有發布草稿。保留既有故事及沖煮文字，管理員須另外核對它們有無不受實測支持的保證。
8. 回後台審核發布。發布交易再讀取不可變更的場次、核對本批烘焙指紋、用詞及日期；只填日期不再足以新增「本批杯測確認」。目前單人描述不換算杯測分數，公開分數固定 0／不展示。

## 資料與權限

- 原始資料：`coffee_roast_drafts/{batchId}/cupping_sessions/{sessionId}`。僅合法、未過期的咖啡管理員可讀寫；鎖定後連管理員前端也不可覆寫／刪除。草稿版本 UUID 可防其他分頁覆蓋。
- 每場固定記 `method: solo`、`roastColor: unmeasured`、原始表單、烘焙身分快照／SHA-256、開始前的文案快照、建立／更新／鎖定時間。沒有儀器讀值或自動補測數字。
- 發展秒數由有效一爆起點與下豆時間相減；缺資料顯示未知。不存在的曲線與 JSON 空陣列採一致指紋，避免儲存格式造成誤判。生豆 lot 是杯測時人工填入的身分，不自動修改既有生豆資料。
- 私有草稿保存 `cuppingSessionIds`，不進公開欄位白名單。公開僅存 `sensoryProfile`：`method`、`status`、`dates`、`flavor`、`mouthfeel`、`aftertaste`。操作者、原始長文、逐杯異常、喜好筆記與場次 ID 不公開。
- 舊三段欄位只作向後相容鏡像：有新的獨立杯測摘要才把三欄寫為風味／口感／餘韻；不將舊 `flavorMid` 當成口感。沒有新摘要的舊資料保留初韻／中調／尾韻語意。
- Firestore 規則保護管理員身分、資料型態、鎖定不可變、同批來源、兩場基本條件、公開白名單及發布交易。完整日期、全部觀察完成、逐杯詞彙重現與溫差等業務語意由共用模型／服務驗證；不能把這套自填紀錄說成系統已證明真的品飲，或把管理員自我陳述當成獨立第三方認證。原始觀察細節的規則檢查有意限制在運算預算內，沒有對每段文字做語意判真。
- 同專案教學集合、Worker、密碼、正式資料均未改動。AI 若另改三段描述而與杯測摘要不符，發布會被擋；可重新採用杯測，或明確移除杯測摘要並重新填參考描述，原始證據仍保留。

## 公開頁與標籤

首頁使用共用 `css/public-site.css`：維持深咖啡色與金色品牌，減少裝飾漸層、收斂字距與小字，豆單為主要入口，管理功能收進次要工具區，卡片強化風味資訊。單品頁改善資訊層級、基本資料、閱讀行距與手機排版，標示參考／本批單人實測／複測，不以描述充作認證。

具已發布杯測摘要且 `sensoryBasis: cupped` 才展示新的獨立三欄；舊資料不假設有新實測。未找到 ID 不替代其他豆款，動態內容沿用 textContent／HTML escaping。標籤也分別使用風味／口感／餘韻及單人依據，仍支援既有 PNG／JSON、尺寸、溢位、13 字與版本檢查。

本輪視覺範圍是首頁及共用動態 `bean.html`；舊獨立靜態豆種 HTML 尚未全面重製或轉址。仍使用現有 Tailwind／字型 CDN，尚未自託管或做完整效能稽核。

## 驗證與上線條件

    node --test tests/*.test.cjs
    node --test cloudflare-worker/test/*.test.js
    firebase emulators:exec --only firestore --project demo-coffee-security 'node --test tests/cupping-workflow.integration.cjs tests/firestore-rules.integration.cjs tests/publication-workflow.integration.cjs'
    node tests/cupping-tool.browser.cjs
    node tests/public-site-visual.browser.cjs
    node tests/label-tool.browser.cjs
    node tests/publication-panel.browser.cjs

測試均使用本機假資料／隔離模擬器，不寫正式紀錄、不呼叫付費 AI。畫面截圖位於 `scratch/public-site-*`、`scratch/cupping-tool-390.png`，不是商品資料。

本輪結果：36 項單元測試、24 項 Firestore／發布／杯測整合測試、9 項 Worker 測試通過；杯測、發布審核、標籤與公開頁四組瀏覽器測試通過。已補入異常匯入資料防護。桌面 1280px 與手機 390px 公開頁未見水平溢位，瀏覽器測試無未處理頁面錯誤。這不取代正式登入驗收或實體列印測試。

本次需要前端與 Firestore 規則配套，不能只推 main 讓新介面先上線。下次使用者授權部署後：讀回正式規則確認其他集合未變 → 建立待發布正式版本（含共用 CSS 與全部杯測模組）→ 驗證檔案／私有排除／登入 → 發布新規則並讀回 → 立即升級已測試前端 → 驗證公開讀取、原始杯測匿名拒讀寫與新流程。舊後台只填日期的杯測發布會被新規則拒絕，必須重新整理並連結真正場次。既有已發布資料不批次遷移或改寫。

仍未完成：正式環境新杯測端到端驗收、使用者真實杯測、獨立多人校準、儀器焙色、感官強度的標準參照訓練、與真正凍結模型預測的準確度評估／再訓練。實體標籤試印與手機掃碼亦仍須使用者驗收。

參考：[SCA CVA](https://sca.coffee/value-assessment)、[SCA-102 樣品準備與品飲](https://sca.coffee/s/AW_SCA-102_Sample-Preparation_281024_Secured.pdf)、[Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)、[Firestore rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)。本工具是店內適配流程，不宣稱完整執行正式 CVA 評分規程。
