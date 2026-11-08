/**
 * Firebase Web SDK 初期化モジュール
 *
 * Firebase Authentication および Cloud Firestore を初期化し、
 * オフライン永続化キャッシュ（IndexedDB）を有効化してエクスポートします。
 * 公開用設定（APIキー等）のみを使用し、秘密鍵は一切含みません。
 */

import { RUNTIME_CONFIG, AUTH_USER_MAP } from "./runtime-config.js";

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

    // usersドキュメントが未作成の場合のフォールバック (メールアドレスから安全に初期判定)
    let fallbackRole = "guest";
    let fallbackName = user.displayName || user.email;
    let fallbackIsAdmin = false;
    let fallbackIsOfficer = false;

    if (user.email) {
        if (user.email.includes("niina@")) {
            fallbackRole = "admin";
            fallbackName = "新名 (システム管理者)";
            fallbackIsAdmin = true;
            fallbackIsOfficer = true;
        } else if (user.email.includes("officer@")) {
            fallbackRole = "officer";
            fallbackName = "役員共通アカウント";
            fallbackIsOfficer = true;
        } else if (user.email.includes("member@")) {
            fallbackRole = "member";
            fallbackName = "町内会員 (閲覧専用)";
        }
    }

    return {
        user,
        uid: user.uid,
        email: user.email,
        role: fallbackRole,
        name: fallbackName,
        group: "",
        isAdmin: fallbackIsAdmin,
        isOfficer: fallbackIsOfficer,
        isCommonMember: isCommon,
        canManage: fallbackIsOfficer
    };
}

/**
 * 要件3: ユーザーIDを正規化し、設定ファイルからFirebase登録用メールアドレスを取得
 * ユーザーにはメールアドレスを入力させず、IDから安全に変換します。
 */
export function resolveEmailFromUserId(userId) {
    const raw = String(userId || "").trim();
    if (!raw) return null;
    if (raw.includes("@")) {
        return raw; // メールアドレス直接入力との互換性
    }
    const normalized = raw.toLowerCase();
    return AUTH_USER_MAP[normalized] || null;
}

/**
 * 要件2, 5, 6: ユーザーID＋パスワードによるFirebase Authenticationログイン
 * メールアドレスを入力させず、従来のGASと同じ「ユーザーID＋パスワード」で認証します。
 * 認証成功後は入力IDではなく、Firebase UIDとFirestoreプロファイルに基づいて権限を厳密判定します。
 *
 * @param {string} userId ユーザーID (niina, officer, member)
 * @param {string} password パスワード (または共通合言葉)
 */
export async function signInWithUserId(userId, password) {
    if (!firebaseAuth) {
        return { ok: false, errorType: "UNCONFIGURED", message: "Firebase Authが初期化されていません。" };
    }

    const email = resolveEmailFromUserId(userId);
    if (!email) {
        return {
            ok: false,
            errorType: "INVALID_USER_ID",
            message: `ユーザーID「${userId}」は登録されていません。(利用可能なID: niina, officer, member)`
        };
    }

    const pwd = String(password || "").trim();
    if (!pwd) {
        return { ok: false, errorType: "EMPTY_PASSWORD", message: "パスワードを入力してください。" };
    }

    try {
        const userCredential = await signInWithEmailAndPassword(firebaseAuth, email, pwd);
        // 要件6: 入力されたユーザーIDではなくFirebase UIDに基づいて権限を判定
        const profile = await getCurrentUserProfile();

        return {
            ok: true,
            user: userCredential.user,
            uid: userCredential.user.uid,
            profile,
            role: profile?.role || "member",
            canManage: Boolean(profile?.canManage)
        };
    } catch (err) {
        const code = err.code || "";
        let message = "ユーザーIDまたはパスワードが正しくありません。";
        if (code === "auth/user-not-found") {
            message = `アカウント「${userId}」がFirebase Authenticationに未作成です。(Firebase Consoleで手動作成が必要です)`;
        } else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
            message = "パスワードが正しくありません。";
        } else if (code === "auth/too-many-requests") {
            message = "ログイン試行回数が多すぎます。しばらく時間をおいてから再度お試しください。";
        }
        return {
            ok: false,
            errorType: code || "AUTH_FAILED",
            message
        };
    }
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

