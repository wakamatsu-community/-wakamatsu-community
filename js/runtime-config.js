const runtime = (typeof window !== "undefined" && window.RUNTIME_CONFIG)
    ? window.RUNTIME_CONFIG
    : {};

// 要件3 & 4: ユーザーIDとFirebase認証メールアドレスの対応表 (パスワード・秘密鍵を含まない設定管理)
const defaultUserMap = {
    niina: "niina@wakamatsu-cho.internal",
    officer: "officer@wakamatsu-cho.internal",
    member: "member@wakamatsu-cho.internal"
};
const customUserMap = (typeof runtime.AUTH_USER_MAP === "object" && runtime.AUTH_USER_MAP !== null)
    ? runtime.AUTH_USER_MAP
    : {};

export const AUTH_USER_MAP = Object.freeze({
    ...defaultUserMap,
    ...customUserMap
});

export const RUNTIME_CONFIG = Object.freeze({
    GAS_WEB_APP_URL: String(runtime.GAS_WEB_APP_URL || "").trim(),
    GOOGLE_CALENDAR_API_KEY: String(runtime.GOOGLE_CALENDAR_API_KEY || "").trim(),
    GOOGLE_CALENDAR_ID: String(runtime.GOOGLE_CALENDAR_ID || "").trim(),
    FIREBASE_API_KEY: String(runtime.FIREBASE_API_KEY || "").trim(),
    FIREBASE_AUTH_DOMAIN: String(runtime.FIREBASE_AUTH_DOMAIN || "").trim(),
    FIREBASE_PROJECT_ID: String(runtime.FIREBASE_PROJECT_ID || "").trim(),
    FIREBASE_STORAGE_BUCKET: String(runtime.FIREBASE_STORAGE_BUCKET || "").trim(),
    FIREBASE_MESSAGING_SENDER_ID: String(runtime.FIREBASE_MESSAGING_SENDER_ID || "").trim(),
    FIREBASE_APP_ID: String(runtime.FIREBASE_APP_ID || "").trim(),
    FIREBASE_MEASUREMENT_ID: String(runtime.FIREBASE_MEASUREMENT_ID || "").trim()
});
