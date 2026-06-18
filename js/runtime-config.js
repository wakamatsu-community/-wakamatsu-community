const runtime = (typeof window !== "undefined" && window.RUNTIME_CONFIG)
    ? window.RUNTIME_CONFIG
    : {};

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
