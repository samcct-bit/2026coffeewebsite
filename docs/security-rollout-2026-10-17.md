# 咖啡網站權限強化：上線檢核

## 狀態

安全修正已通過本機測試，Worker 待發布版本已上傳，尚未切換正式流量或發布正式規則。正式規則仍有未登入可新增／修改 coffee_roasts 的風險；不能將本機測試通過視為正式站已受到保護。

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

- 本機 Node 測試：AI 證據與安全 DOM 14 項、Worker 身分驗證與介面 8 項。
- Wrangler dry-run 建置成功，未上傳。
- 只查詢正式 Worker Secret 名稱：必要名稱已存在，未讀取或證明內容有效。
- 發現一個 Secret 名稱疑似 API 金鑰，未複製到文件。應在供應商端撤銷／換發，更新正確 Secret，確認運作後再移除錯誤命名項目。
- 已使用官方 Temurin Java 21 可攜環境及 Firestore Emulator，在 `demo-coffee-security` 離線專案通過 8 組權限整合測試：公開讀取、匿名拒寫、一般帳號拒寫、角色／UID／期限檢查、合法管理員完整生命週期、資料欄位驗證、其他集合拒絕、教學集合權限保留。官方 Rules API 語法驗證亦通過。
- 四個頁面（首頁、資料庫、即時烘焙、莫札特批次頁）以獨立無登入 Edge 測試通過，Firebase 模組可載入，後台保持登入鎖定，沒有 pageerror。測試等待 DOM／模組就緒，不等待 Firestore 長連線停止。
- Worker 待發布版本 `148292c4-603c-41ce-bd62-ac53c81e9af6`，預覽 URL `https://148292c4-gsk-groq-proxy.gansingkim.workers.dev`。實際預覽回應：匿名 AI 401、匿名刪除 401、空密碼 400、正式網域 CORS preflight 204。正式版本仍未切換。
- Vercel 連接器對 sam-vegan scope 回覆 403，已改用 CLI；使用者完成 device login，已核對並連結 `sam-vegan/2026coffeewebsite`，ID 為 `prj_QoNw9s6DUiJt4wsfq795a9af2scG`。CLI 自動產生的 `.env.local` 已由忽略規則排除，不可提交或部署。
- 尚未完成真實 Firebase custom-token 交換與瀏覽器登入、過期、儲存、刪除端到端驗證。

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
