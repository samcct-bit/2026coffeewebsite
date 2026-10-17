# 咖啡網站權限強化：上線檢核

## 狀態

2026-10-17 台灣時間 22:19 已完成第一階段正式上線與權限驗證。網站原始碼提交 `58e00b3`，Vercel 部署 `dpl_9oCifoFV8EUgeFpPtiQ8qRBTu8bg`；後續登入設定修復及 Worker 變更另記於下方。Firestore 規則已正式發布，匿名寫入漏洞已關閉；正式管理員新增、修改、刪除與公開讀取均實測通過。

使用者已確認 Firebase 專案為 `my-teaching-tools-01`。同專案的 summer_homework_2026 權限已保留，不更動教學資料。

## 修正範圍

- 密碼僅由 Worker 驗證，換取 Firebase custom token；瀏覽器再向 Firebase 交換 ID token。
- 伺服器驗證 Google 簽章、issuer、audience、固定管理員 UID、角色與一小時絕對期限。
- Firestore 寫入與刪除須通過規則，不再只憑前端 sessionStorage。
- 刪除轉送使用者 ID token，不用服務帳戶繞過資料庫規則。
- 登入、AI、管理操作分別限流；缺少 binding 時拒絕操作。原生限流是各 Cloudflare 位置的近似限制，並非全球精準預算。
- 限制請求大小、模型、訊息長度、輸出 token；不轉送任意工具參數。
- 豆名、事件、時間軸等動態內容跳脫；來源網址限定 HTTP(S)。
- 移除讀取資料庫時自動回寫種子資料的行為。
- 加入安全標頭與部署排除清單。嚴格 script CSP 目前只有 Report-Only（瀏覽器主控台觀察，無集中收報），尚未全面強制。

## 已檢查與尚待檢查

- 本機 Node 測試：AI 證據與安全 DOM 14 項、Worker 身分驗證與介面 9 項；加上離線規則 8 組，共 31 項。
- Wrangler dry-run 建置成功，未上傳。
- 只查詢正式 Worker Secret 名稱：必要名稱已存在，未讀取或證明內容有效。
- 發現一個 Secret 名稱疑似 API 金鑰，未複製到文件。應在供應商端撤銷／換發，更新正確 Secret，確認運作後再移除錯誤命名項目。
- 已使用官方 Temurin Java 21 可攜環境及 Firestore Emulator，在 `demo-coffee-security` 離線專案通過 8 組權限整合測試：公開讀取、匿名拒寫、一般帳號拒寫、角色／UID／期限檢查、合法管理員完整生命週期、資料欄位驗證、其他集合拒絕、教學集合權限保留。官方 Rules API 語法驗證亦通過。
- 四個頁面（首頁、資料庫、即時烘焙、莫札特批次頁）以獨立無登入 Edge 測試通過，Firebase 模組可載入，後台保持登入鎖定，沒有 pageerror。測試等待 DOM／模組就緒，不等待 Firestore 長連線停止。
- Worker 版本 `148292c4-603c-41ce-bd62-ac53c81e9af6`，預覽 URL `https://148292c4-gsk-groq-proxy.gansingkim.workers.dev`。實際預覽回應：匿名 AI 401、匿名刪除 401、空密碼 400、正式網域 CORS preflight 204；此版本已切換 100% 正式流量，正式匿名 AI 亦確認回覆 401。
- Vercel 部署 `https://2026coffeewebsite-1r05p2mqs-sam-vegan.vercel.app` 已使用官方 CLI 通過 6 個主要檔案雜湊核對、安全標頭檢查與 5 個私密路徑 404 檢查，再升級到正式網域。正式首頁回覆 200，已載入 security-v8；登入模組 200，環境檔與刪除管理腳本 404。
- Vercel 連接器對 sam-vegan scope 回覆 403，已改用 CLI；使用者完成 device login，已核對並連結 `sam-vegan/2026coffeewebsite`，ID 為 `prj_QoNw9s6DUiJt4wsfq795a9af2scG`。CLI 自動產生的 `.env.local` 已由忽略規則排除，不可提交或部署。
- 使用既有服務帳戶產生與網站相同的 custom token，完成真實 Firebase ID-token 交換與正式 Worker 簽章／管理員角色驗證。Token 僅保留在測試程序記憶體，程序已退出。這項後端驗證不等同於使用者已完成瀏覽器密碼登入；仍請使用者以剛設定的新密碼登入確認。

## 2026-10-17 密碼重設與正式驗證結果

- 使用者明確同意重設後，已於本機遮罩視窗自行設定新密碼，成功更新 PASSWORD_HASH。第一次顯示失敗實際發生在後續登入簽章，並非密碼寫入失敗；明文密碼未寫入檔案或對話。
- 根因：既有 FIREBASE_PRIVATE_KEY 無法載入。已加入常見 PEM 引號／換行格式相容與不含機密的錯誤訊息，通過新增測試後發布。
- 從既有本機專案憑證確認 project_id 為 my-teaching-tools-01，並比對 Google 公開憑證，確認私鑰可解析且對應有效公開金鑰，才修復三個 Firebase Worker 設定。沒有建立新服務帳戶或新金鑰，也未再次變更 PASSWORD_HASH。
- 修復後正式 Worker 版本為 `ba051181-409f-408c-a5d6-1f2c45781460`（100% 流量）；程式修正版本為 `2dd66030-1ce8-413d-b316-1fbe2386d19a`，之後僅更新 Firebase Secrets。
- 初次部署工具回報成功後，重新讀取規則仍是舊版；已用官方 CLI 明確發布 `firestore:rules`，看到 released 訊息後再讀回確認新規則，才執行正式測試。教學集合權限保留。
- 正式專用測試文件驗證：匿名新增 403、管理員新增 200、公開讀取 200、匿名修改 403、匿名刪除 403、管理員修改 200、Worker 管理員刪除 200、刪除後讀取 404。
- 測試文件已刪除，未修改既有烘焙紀錄；不需要恢復。

## 上線順序與放行條件

1. 用 emulator 或 Firebase 規則測試介面驗證匿名、一般使用者、過期管理員拒寫，合法管理員可寫合法資料，教學集合權限不變。
2. 確認 FIREBASE_PROJECT_ID Secret 內容為已確認專案（勿輸出值或私鑰到記錄）。此名稱已有 Secret，wrangler 不另設同名 vars。
3. 準備 Worker 與前端配對發布；新 Worker 不接受舊前端假登入。遷移期間可能暫時無法管理。
4. 使用者在登入表單輸入既有密碼，驗證 Firebase 登入成功；不要把密碼貼到對話。
5. 部署前重新讀取正式 Firestore 規則，比對備份，確認其他集合沒有新增變更，再發布已測試規則。
6. 用專用測試文件測試新增、更新與刪除；不修改既有咖啡資料作測試。確認匿名寫入拒絕、公開豆單仍能讀取。
7. 完成後才宣告正式安全修正上線。若登入出錯，修復登入／配套版本，不以恢復匿名寫入作回滾。

## 剩餘限制

目前仍是共用管理密碼，不是個人帳號、MFA 或完整稽核制度。沿用既有 SHA-256 密碼 Secret 作遷移；後續應改個人登入。登出清除目前瀏覽器登入，已外流 token 仍可能在一小時期限內有效。公開 coffee_roasts 的所有欄位仍可被讀取，機密資料應另放私有集合。App Check、全球費用上限、金鑰輪替尚未完成。

## 重現離線規則測試

先安裝官方 Java 21 並設定 JAVA_HOME，再於專案根目錄執行：

```powershell
npm install --prefix scratch/security-runtime --ignore-scripts --no-audit --no-fund @firebase/rules-unit-testing@6.0.0 firebase@13.0.0
firebase emulators:exec --only firestore --project demo-coffee-security 'node --test tests/firestore-rules.integration.cjs'
```

暫存套件、Java 環境與 emulator 記錄皆不提交或部署。

## 2026-10-17 取得的原始規則（僅供比對，不可拿來恢復匿名寫入）

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /coffee_roasts/{document} {
      allow read: if true;
      allow create, update: if request.resource.data.keys().hasAny(['beanName', 'roastDate']);
      allow delete: if false;
    }
    match /summer_homework_2026/{document} {
      allow read: if request.auth != null && request.auth.token.email == 'samcct@gmail.com';
      allow create, update, delete: if false;
    }
  }
}
```
