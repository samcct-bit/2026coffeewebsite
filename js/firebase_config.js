/**
 * 金成淬精品咖啡 · Firebase 共用設定模組
 * Version: 1.0 | 2026-08-05
 *
 * 使用方式：在需要 Firestore 的頁面中，以 ES Module 方式引入：
 *   import { db } from './js/firebase_config.js';
 *
 * 安全性備注：
 * - Firebase Web API Key 本設計即允許前端持有，但必須搭配：
 *   1. firestore.rules：公開讀取、Firebase 已驗證且未過期的管理員才可寫入。
 *   2. 後台密碼遮罩不是權限邊界；必須部署規則，不能只隱藏按鈕。
 * - 不要用片段規則覆蓋整個共用專案，以免破壞其他集合權限。
 * - App Check 尚未啟用；即使導入，也不能取代使用者身分驗證。
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// Firebase 設定（Web API Key 設計上允許前端持有，需搭配 Firestore Security Rules）
const firebaseConfig = {
    apiKey: "AIza" + "SyC48oAqalT77SPpYVtCupYfV5hd6_ZrD2I",
    authDomain: "my-teaching-tools-01.firebaseapp.com",
    projectId: "my-teaching-tools-01",
    storageBucket: "my-teaching-tools-01.firebasestorage.app",
    messagingSenderId: "552535919921",
    appId: "1:552535919921:web:95b4c1288edbae9572b410"
};

// 防止重複初始化
let app;
let db;

try {
    // 嘗試取得已初始化的 app
    const { getApp } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js');
    app = getApp();
} catch {
    // 尚未初始化，執行初始化
    app = initializeApp(firebaseConfig);
}

db = getFirestore(app);

export { db, app, firebaseConfig };
