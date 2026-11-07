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
    createUserWithEmailAndPassword,
    updatePassword
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
/**
 * 現在のログインユーザーとロール情報を取得する (要件2, 9, 10: 役員・管理者・共通会員の厳格分離)
 * @returns {Promise<{ user: any, role: string, name: string, isAdmin: boolean, isOfficer: boolean, isCommonMember: boolean, canManage: boolean } | null>}
 */
export async function getCurrentUserProfile() {
    if (!firebaseAuth || !firebaseAuth.currentUser || !firestoreDb) {
        return null;
    }

    const user = firebaseAuth.currentUser;
    const isCommon = Boolean(user.email && user.email.includes("member@"));

    try {
        const userDocRef = doc(firestoreDb, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            const role = data.role || (isCommon ? "member" : "guest");
            const isAdmin = role === "admin";
            const isOfficer = role === "officer" || isAdmin;

            return {
                user,
                uid: user.uid,
                email: user.email,
                role,
                name: data.name || user.displayName || user.email,
                group: data.group || "",
                isAdmin,
                isOfficer,
                isCommonMember: isCommon,
                canManage: isOfficer
            };
        }
    } catch (err) {
        console.warn("[Firebase] ユーザープロファイル取得例外:", err);
    }

    // usersドキュメントが未作成の場合のフォールバック
    const fallbackRole = isCommon ? "member" : "guest";
    return {
        user,
        uid: user.uid,
        email: user.email,
        role: fallbackRole,
        name: isCommon ? "町内会員(共通合言葉)" : (user.displayName || user.email),
        group: "",
        isAdmin: false,
        isOfficer: false,
        isCommonMember: isCommon,
        canManage: false
    };
}

/**
 * 要件1 & 5: 町内会共通合言葉によるサーバー側安全認証 (閲覧専用)
 */
export async function signInWithMemberPasscode(passcode, customEmail = null) {
    if (!firebaseAuth) {
        return { ok: false, errorType: "UNCONFIGURED", message: "Firebase Authが初期化されていません。" };
    }
    const memberEmail = customEmail || RUNTIME_CONFIG.MEMBER_AUTH_EMAIL || "member@wakamatsu-cho.internal";
    try {
        const userCredential = await signInWithEmailAndPassword(firebaseAuth, memberEmail, passcode);
        return {
            ok: true,
            user: userCredential.user,
            role: "member"
        };
    } catch (err) {
        const code = err.code || "";
        let message = "合言葉が正しくありません。町内会報記載の合言葉を確認してください。";
        if (code === "auth/user-not-found") {
            message = "共通会員アカウントがFirebase Authenticationに未作成です。(Firebase Consoleで設定が必要です)";
        }
        return {
            ok: false,
            errorType: code || "AUTH_FAILED",
            message
        };
    }
}

/**
 * 要件2 & 5: 役員・システム管理者による個別認証 (管理操作権限)
 */
export async function signInWithOfficerCredentials(email, password) {
    if (!firebaseAuth) {
        return { ok: false, errorType: "UNCONFIGURED", message: "Firebase Authが初期化されていません。" };
    }
    try {
        const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, password);
        const profile = await getCurrentUserProfile();
        if (!profile || (!profile.isOfficer && !profile.isAdmin)) {
            // 役員権限がない場合は警告
            return {
                ok: true,
                user: userCredential.user,
                profile,
                warning: "一般会員アカウントです。管理操作を行うには役員権限が必要です。"
            };
        }
        return {
            ok: true,
            user: userCredential.user,
            profile
        };
    } catch (err) {
        const code = err.code || "";
        let message = "メールアドレスまたはパスワードが正しくありません。";
        if (code === "auth/user-not-found") {
            message = "指定された役員アカウントが存在しません。";
        } else if (code === "auth/wrong-password") {
            message = "パスワードが正しくありません。";
        }
        return {
            ok: false,
            errorType: code || "AUTH_FAILED",
            message
        };
    }
}

/**
 * 要件5: ログアウト処理
 */
export async function signOutUser() {
    if (!firebaseAuth) return { ok: true };
    try {
        await signOut(firebaseAuth);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err };
    }
}

/**
 * 要件5: 役員・管理者のパスワード変更
 */
export async function updateUserPassword(newPassword) {
    if (!firebaseAuth || !firebaseAuth.currentUser) {
        return { ok: false, message: "ログインしていません。" };
    }
    if (firebaseAuth.currentUser.email && firebaseAuth.currentUser.email.includes("member@")) {
        return { ok: false, message: "共通会員アカウントのパスワードは管理コンソールからのみ変更できます。" };
    }
    if (!newPassword || newPassword.length < 8) {
        return { ok: false, message: "パスワードは8文字以上の英数記号で指定してください。" };
    }
    try {
        await updatePassword(firebaseAuth.currentUser, newPassword);
        return { ok: true, message: "パスワードを変更しました。" };
    } catch (err) {
        const code = err.code || "";
        let message = "パスワード変更に失敗しました。";
        if (code === "auth/requires-recent-login") {
            message = "セキュリティのため、再ログインしてから再度変更をお試しください。";
        }
        return { ok: false, errorType: code, message };
    }
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

