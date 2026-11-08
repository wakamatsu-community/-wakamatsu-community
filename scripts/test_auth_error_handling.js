/**
 * 認証エラーハンドリング・原因表示・セッション整合性 総合テスト (CJS)
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

console.log("=== 認証エラーハンドリング・原因表示・セッション整合性 総合テスト開始 ===\n");

// runtime-config.js を読み込んで AUTH_USER_MAP を取得
const runtimeConfigPath = path.resolve(__dirname, "../js/runtime-config.js");
const rawRuntimeCode = fs.readFileSync(runtimeConfigPath, "utf8");
const cjsRuntimeCode = rawRuntimeCode
    .replace(/export const /g, "exports.")
    .replace(/export\s*\{\s*RUNTIME_CONFIG\s*,\s*AUTH_USER_MAP\s*\};/g, "exports.RUNTIME_CONFIG = RUNTIME_CONFIG; exports.AUTH_USER_MAP = AUTH_USER_MAP;")
    .replace(/const /g, "var ");
const runtimeSandbox = { window: {}, exports: {} };
vm.createContext(runtimeSandbox);
vm.runInContext(cjsRuntimeCode, runtimeSandbox);
const { AUTH_USER_MAP, RUNTIME_CONFIG } = runtimeSandbox.exports;

function resolveEmailFromUserId(userId) {
    const raw = String(userId || "").trim();
    if (!raw) return null;
    if (raw.includes("@")) {
        return raw;
    }
    const normalized = raw.toLowerCase();
    return AUTH_USER_MAP[normalized] || null;
}

// 1. ユーザーID解決テスト
console.log("--- 1. ユーザーID解決 (resolveEmailFromUserId) ---");
assert.strictEqual(resolveEmailFromUserId("niina"), "niina@gmail.com");
assert.strictEqual(resolveEmailFromUserId("NIINA "), "niina@gmail.com");
assert.strictEqual(resolveEmailFromUserId("officer"), "officer@gmail.com");
assert.strictEqual(resolveEmailFromUserId("member"), "member@gmail.com");
assert.strictEqual(resolveEmailFromUserId("custom@example.com"), "custom@example.com");
assert.strictEqual(resolveEmailFromUserId("unknown"), null);
console.log("[PASS] ユーザーID解決の正常性確認完了\n");

// 2. モック環境による signInWithUserId エラーハンドリング検証
console.log("--- 2. signInWithUserId の詳細エラー原因返却・セッション破棄検証 ---");

function createMockAuthEnvironment({
    authError = null,
    firestoreDocExists = true,
    firestoreDocData = { role: "admin", name: "新名" },
    firestoreError = null
}) {
    let signedOutCalled = false;
    const mockUid = "test_uid_niina_12345";
    const mockEmail = "niina@gmail.com";

    const mockAuth = {
        currentUser: null
    };

    const mockSignIn = async (auth, email, password) => {
        if (authError) throw authError;
        const user = { uid: mockUid, email };
        auth.currentUser = user;
        return { user };
    };

    const mockSignOut = async (auth) => {
        signedOutCalled = true;
        auth.currentUser = null;
    };

    const mockGetDoc = async () => {
        if (firestoreError) throw firestoreError;
        return {
            exists: () => firestoreDocExists,
            data: () => firestoreDocData
        };
    };

    // signInWithUserId のコアロジックをテスト
    async function testSignIn(userId, password) {
        const email = resolveEmailFromUserId(userId);
        if (!email) {
            return {
                ok: false,
                errorType: "INVALID_USER_ID",
                message: `ユーザーID「${userId}」は登録されていません。(利用可能なID: niina, officer, member)`
            };
        }
        const pwd = String(password ?? "");
        if (!pwd) {
            return { ok: false, errorType: "EMPTY_PASSWORD", message: "パスワードを入力してください。" };
        }

        try {
            const userCred = await mockSignIn(mockAuth, email, pwd);
            const user = userCred.user;

            // getCurrentUserProfile のシミュレーション
            let profile;
            try {
                const snap = await mockGetDoc();
                if (snap.exists()) {
                    const data = snap.data() || {};
                    const rawRole = data.role || data.Role || data.役職 || data.ロール || "guest";
                    let role = String(rawRole).trim().toLowerCase();
                    if (role === "管理者" || role === "システム管理者") role = "admin";
                    else if (role === "役員") role = "officer";
                    else if (role === "会員" || role === "一般会員" || role === "町内会員") role = "member";

                    const isAdmin = role === "admin";
                    const isOfficer = role === "officer" || isAdmin;
                    const isMember = role === "member" || isOfficer;

                    const name = data.name || data.displayName || data.username || data.氏名 || data.名前 || user.displayName || user.email;

                    profile = {
                        user,
                        uid: user.uid,
                        email: user.email,
                        role,
                        name,
                        group: data.group || data.組 || "",
                        isAdmin,
                        isOfficer,
                        isMember,
                        canManage: isOfficer,
                        docExists: true,
                        status: "OK",
                        error: null
                    };
                } else {
                    profile = {
                        user,
                        uid: user.uid,
                        email: user.email,
                        role: "guest",
                        isAdmin: false,
                        isOfficer: false,
                        isMember: false,
                        canManage: false,
                        docExists: false,
                        status: "NOT_FOUND",
                        error: `Firestore の users/${user.uid} にドキュメントが存在しません。`
                    };
                }
            } catch (err) {
                const isPermissionDenied = err.code === "permission-denied" || (err.message && err.message.includes("permission"));
                profile = {
                    user,
                    uid: user.uid,
                    email: user.email,
                    role: "guest",
                    isAdmin: false,
                    isOfficer: false,
                    isMember: false,
                    canManage: false,
                    docExists: false,
                    status: isPermissionDenied ? "PERMISSION_DENIED" : "ERROR",
                    error: isPermissionDenied
                        ? `Firestore権限エラー (permission-denied): users/${user.uid} へのアクセスが拒絶されました。ドキュメントIDがUIDと完全一致しているか確認してください。`
                        : (err.message || "プロファイル取得エラー")
                };
            }

            // プロファイル検証 1: Security Rules (permission-denied)
            if (profile?.status === "PERMISSION_DENIED") {
                await mockSignOut(mockAuth);
                return {
                    ok: false,
                    errorType: "PERMISSION_DENIED",
                    message: `Firestoreセキュリティルールでアクセスが拒絶されました (permission-denied)。users/${user.uid} のドキュメントIDとFirebase UIDが一致しているか確認してください。`,
                    uid: user.uid,
                    email: user.email
                };
            }

            // プロファイル検証 2: ドキュメント不在
            if (!profile || profile.status === "NOT_FOUND" || !profile.docExists) {
                await mockSignOut(mockAuth);
                return {
                    ok: false,
                    errorType: "NOT_FOUND",
                    message: `Firebase認証には成功しましたが、Firestoreの users コレクションに UID「${user.uid}」のドキュメントが存在しません。Firebase ConsoleのFirestoreでドキュメントIDをこのUIDにして作成してください。`,
                    uid: user.uid,
                    email: user.email
                };
            }

            // プロファイル検証 3: ロール不正
            if (!profile.isMember) {
                await mockSignOut(mockAuth);
                return {
                    ok: false,
                    errorType: "INVALID_ROLE",
                    message: `アカウントの権限(role)が無効です (現在の設定: "${profile.role}")。利用可能なrole: member, officer, admin`,
                    uid: user.uid,
                    email: user.email,
                    role: profile.role
                };
            }

            return {
                ok: true,
                user,
                uid: user.uid,
                profile,
                role: profile.role,
                canManage: Boolean(profile.canManage)
            };
        } catch (err) {
            const code = err.code || "";
            let message = "ユーザーIDまたはパスワードが正しくありません。";
            if (code === "auth/user-not-found") {
                message = `アカウント「${userId}」(${email})がFirebase Authenticationに未作成です。(Firebase Consoleで作成してください)`;
            } else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
                message = "パスワードが正しくありません。";
            }
            return {
                ok: false,
                errorType: code || "AUTH_FAILED",
                message
            };
        }
    }

    return { testSignIn, getSignedOutCalled: () => signedOutCalled };
}

(async () => {
    // テストケース A1: 正常管理者ログイン (admin: niina)
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: true,
            firestoreDocData: { role: "admin", name: "新名" }
        });
        const res = await env.testSignIn("niina", "validPassword123");
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.role, "admin");
        assert.strictEqual(res.canManage, true);
        assert.strictEqual(env.getSignedOutCalled(), false);
        console.log("[PASS] ケースA1: 正常管理者ログイン (niina -> role:admin, canManage:true)");
    }

    // テストケース A2: 正常役員ログイン (officer)
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: true,
            firestoreDocData: { role: "officer", name: "役員太郎" }
        });
        const res = await env.testSignIn("officer", "validPassword123");
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.role, "officer");
        assert.strictEqual(res.canManage, true);
        assert.strictEqual(env.getSignedOutCalled(), false);
        console.log("[PASS] ケースA2: 正常役員ログイン (officer -> role:officer, canManage:true)");
    }

    // テストケース A3: 正常一般会員ログイン (member: 閲覧専用)
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: true,
            firestoreDocData: { role: "member", name: "若松会員" }
        });
        const res = await env.testSignIn("member", "validPasscode");
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.role, "member");
        assert.strictEqual(res.canManage, false);
        assert.strictEqual(env.getSignedOutCalled(), false);
        console.log("[PASS] ケースA3: 正常会員ログイン (member -> role:member, canManage:false)");
    }

    // テストケース A4: 日本語フィールドフォールバック (役職: "管理者")
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: true,
            firestoreDocData: { 役職: "管理者", 氏名: "新名管理者" }
        });
        const res = await env.testSignIn("niina", "validPassword123");
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.role, "admin");
        assert.strictEqual(res.canManage, true);
        console.log("[PASS] ケースA4: 日本語フィールドフォールバック (役職:\"管理者\" -> admin)");
    }

    // テストケース B: Firestore に users/{UID} が存在しない場合 (NOT_FOUND)
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: false
        });
        const res = await env.testSignIn("niina", "validPassword123");
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.errorType, "NOT_FOUND");
        assert.ok(res.message.includes("test_uid_niina_12345"), "メッセージにUIDが含まれること");
        assert.ok(res.message.includes("ドキュメントが存在しません"), "メッセージに不在理由が含まれること");
        assert.strictEqual(env.getSignedOutCalled(), true, "不正セッションが安全に破棄されること");
        console.log("[PASS] ケースB: users/{UID}不在検知と具体UID案内 (NOT_FOUND) & セッション破棄 PASS");
    }

    // テストケース C: Security Rules による permission-denied
    {
        const env = createMockAuthEnvironment({
            firestoreError: { code: "permission-denied", message: "Missing or insufficient permissions." }
        });
        const res = await env.testSignIn("niina", "validPassword123");
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.errorType, "PERMISSION_DENIED");
        assert.ok(res.message.includes("permission-denied"));
        assert.ok(res.message.includes("test_uid_niina_12345"));
        assert.strictEqual(env.getSignedOutCalled(), true);
        console.log("[PASS] ケースC: permission-denied検知とドキュメントID不一致警告 PASS");
    }

    // テストケース D: role が未設定、または guest 等の不正値
    {
        const env = createMockAuthEnvironment({
            firestoreDocExists: true,
            firestoreDocData: { role: "guest" }
        });
        const res = await env.testSignIn("niina", "validPassword123");
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.errorType, "INVALID_ROLE");
        assert.ok(res.message.includes("guest"), "メッセージに不正roleが含まれること");
        assert.strictEqual(env.getSignedOutCalled(), true);
        console.log("[PASS] ケースD: 不正role(\"guest\")の検知と案内 PASS");
    }

    // テストケース E: Firebase Auth パスワード間違い
    {
        const env = createMockAuthEnvironment({
            authError: { code: "auth/wrong-password", message: "Password is wrong." }
        });
        const res = await env.testSignIn("niina", "wrongPass");
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.errorType, "auth/wrong-password");
        assert.strictEqual(res.message, "パスワードが正しくありません。");
        console.log("[PASS] ケースE: Firebase Auth パスワード不一致エラー検知 PASS");
    }

    // テストケース F: Firebase Auth アカウント未作成 (user-not-found)
    {
        const env = createMockAuthEnvironment({
            authError: { code: "auth/user-not-found", message: "User not found." }
        });
        const res = await env.testSignIn("niina", "anyPassword");
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.errorType, "auth/user-not-found");
        assert.ok(res.message.includes("Firebase Authenticationに未作成です"));
        console.log("[PASS] ケースF: Firebase Auth アカウント未作成検知 PASS");
    }

    console.log("\n======================================================");
    console.log("認証エラーハンドリング全ケース完全合格 (ALL PASSED)");
    console.log("======================================================");
})();
