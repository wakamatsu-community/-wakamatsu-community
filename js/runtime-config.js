const runtime = (typeof window !== "undefined" && window.RUNTIME_CONFIG)
    ? window.RUNTIME_CONFIG
    : {};

// Firebase Web SDK 公開接続設定 (クライアント配布用の公開値のみ。秘密鍵・パスワードは一切含みません)
const DEFAULT_FIREBASE_CONFIG = {
    FIREBASE_API_KEY: "AIzaSyCG1BF6gwCofHTPi0gCDZ6bpR2SEzGiEnI",
    FIREBASE_AUTH_DOMAIN: "wakamatu-hp.firebaseapp.com",
    FIREBASE_PROJECT_ID: "wakamatu-hp",
    FIREBASE_STORAGE_BUCKET: "wakamatu-hp.firebasestorage.app",
    FIREBASE_MESSAGING_SENDER_ID: "987020427074",
    FIREBASE_APP_ID: "1:987020427074:web:aef35a2492d6a5ed6cd2db",
    FIREBASE_MEASUREMENT_ID: "G-GYHXRC3HXP"
};

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycby99ILht74ZtoQkKZJ7f97bYgr07wIxwWrbYTOhHq9DSRRPo3x225NrPs3HqlY5-dhb/exec";

// 要件3 & 4: ユーザーIDとFirebase認証メールアドレスの対応表 (パスワード・秘密鍵を含まない設定管理)
const defaultUserMap = {
    niina: "niina@wakamatsu-cho.internal",
    officer: "officer@wakamatsu-cho.internal",
    member: "member@wakamatsu-cho.internal"
};
const customUserMap = (typeof runtime.AUTH_USER_MAP === "object" && runtime.AUTH_USER_MAP !== null)
    ? runtime.AUTH_USER_MAP
    : {};

const AUTH_USER_MAP = Object.freeze({
    ...defaultUserMap,
    ...customUserMap
});

const RUNTIME_CONFIG = Object.freeze({
    GAS_WEB_APP_URL: String(runtime.GAS_WEB_APP_URL || DEFAULT_GAS_URL).trim(),
    GOOGLE_CALENDAR_API_KEY: String(runtime.GOOGLE_CALENDAR_API_KEY || "").trim(),
    GOOGLE_CALENDAR_ID: String(runtime.GOOGLE_CALENDAR_ID || "").trim(),
    FIREBASE_API_KEY: String(runtime.FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.FIREBASE_API_KEY).trim(),
    FIREBASE_AUTH_DOMAIN: String(runtime.FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.FIREBASE_AUTH_DOMAIN).trim(),
    FIREBASE_PROJECT_ID: String(runtime.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.FIREBASE_PROJECT_ID).trim(),
    FIREBASE_STORAGE_BUCKET: String(runtime.FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.FIREBASE_STORAGE_BUCKET).trim(),
    FIREBASE_MESSAGING_SENDER_ID: String(runtime.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.FIREBASE_MESSAGING_SENDER_ID).trim(),
    FIREBASE_APP_ID: String(runtime.FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.FIREBASE_APP_ID).trim(),
    FIREBASE_MEASUREMENT_ID: String(runtime.FIREBASE_MEASUREMENT_ID || DEFAULT_FIREBASE_CONFIG.FIREBASE_MEASUREMENT_ID).trim()
});

if (typeof window !== "undefined") {
    window.RUNTIME_CONFIG = RUNTIME_CONFIG;
    window.AUTH_USER_MAP = AUTH_USER_MAP;
}

export { RUNTIME_CONFIG, AUTH_USER_MAP };
