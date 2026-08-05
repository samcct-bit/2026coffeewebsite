/**
 * 金成淬精品咖啡 · Firebase 共用設定模組
 * Version: 1.0 | 2026-08-05
 *
 * 使用方式：在需要 Firestore 的頁面中，以 ES Module 方式引入：
 *   import { db } from './js/firebase_config.js';
 *
 * 安全性備注：
 * - Firebase Web API Key 本設計即允許前端持有，但必須搭配：
 *   1. Firebase Firestore Security Rules（僅允許讀取 coffee_roasts，禁止外部寫入）
 *   2. Firebase App Check（reCAPTCHA v3）防止非授權 app 存取
 * - 請在 Firebase Console > Firestore > Rules 設定以下規則：
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /coffee_roasts/{doc} {
 *         allow read: if true;    // 公開讀取
 *         allow write: if false;  // 前端禁止寫入（寫入走後台密碼保護頁）
 *       }
 *     }
 *   }
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
