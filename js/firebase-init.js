/**
 * Firebase Web SDK 初期化モジュール
 *
 * Firebase Authentication および Cloud Firestore を初期化し、
 * オフライン永続化キャッシュ（IndexedDB）を有効化してエクスポートします。
 * 公開用設定（APIキー等）のみを使用し、秘密鍵は一切含みません。
 */

import { RUNTIME_CONFIG } from "./runtime-config.js";

// Firebase Web SDK v10 (ES Modules via gstatic CDN)
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    getFirestore,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function getFirebaseConfig() {
    return {
        apiKey: RUNTIME_CONFIG.FIREBASE_API_KEY,
        authDomain: RUNTIME_CONFIG.FIREBASE_AUTH_DOMAIN,
        projectId: RUNTIME_CONFIG.FIREBASE_PROJECT_ID,
        storageBucket: RUNTIME_CONFIG.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: RUNTIME_CONFIG.FIREBASE_MESSAGING_SENDER_ID,
        appId: RUNTIME_CONFIG.FIREBASE_APP_ID,
        measurementId: RUNTIME_CONFIG.FIREBASE_MEASUREMENT_ID
    };
}

let firebaseApp = null;
let firestoreDb = null;
let firebaseAuth = null;
let isConfigured = false;

try {
    const config = getFirebaseConfig();
    if (config.apiKey && config.projectId) {
        firebaseApp = getApps().length > 0 ? getApp() : initializeApp(config);

        // Firestore 初期化（IndexedDBによるマルチタブ永続化オフラインキャッシュ）
        try {
            firestoreDb = initializeFirestore(firebaseApp, {
                localCache: persistentLocalCache({
                    tabManager: persistentMultipleTabManager()
                })
            });
        } catch {
            // すでに初期化済みの場合は既存インスタンスを取得
            firestoreDb = getFirestore(firebaseApp);
        }

        firebaseAuth = getAuth(firebaseApp);
        isConfigured = true;
    } else {
        console.warn("[Firebase] Firebase 設定が未構成です。runtime-config.js を確認してください。");
    }
} catch (err) {
    console.error("[Firebase] 初期化エラー:", err);
}

/**
 * 現在のログインユーザーとロール情報を取得する
 * @returns {Promise<{ user: any, role: string, name: string } | null>}
 */
export async function getCurrentUserProfile() {
    if (!firebaseAuth || !firebaseAuth.currentUser || !firestoreDb) {
        return null;
    }

    const user = firebaseAuth.currentUser;
    try {
        const userDocRef = doc(firestoreDb, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            return {
                user,
                uid: user.uid,
                email: user.email,
                role: data.role || "member",
                name: data.name || user.displayName || user.email,
                group: data.group || ""
            };
        }
    } catch (err) {
        console.warn("[Firebase] ユーザープロファイル取得失敗:", err);
    }

    return {
        user,
        uid: user.uid,
        email: user.email,
        role: "member",
        name: user.displayName || user.email,
        group: ""
    };
}

export {
    firebaseApp,
    firestoreDb as db,
    firebaseAuth as auth,
    isConfigured as isFirebaseReady,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    createUserWithEmailAndPassword
};

