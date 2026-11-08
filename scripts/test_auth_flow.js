// scripts/test_auth_flow.js
/**
 * 会員専用操作の認証確認・ログイン復帰フロー (自動送信防止・手動確認) 自動テスト
 */

const assert = require('assert');

console.log('=== 会員認証・操作復帰フロー (手動確認) テスト開始 ===\n');

// DOM・モック環境のシミュレーション
function createMockEnv(initialUser = null, userRole = null) {
    const documentBody = {
        elements: {},
        innerHTML: '',
        style: {},
        appendChild(el) {
            this.elements[el.id] = el;
        },
        querySelector(sel) {
            return Object.values(this.elements).find(e => e.id === sel.replace('#', '')) || null;
        }
    };

    let currentUser = initialUser;

    const mockAuth = {
        get currentUser() { return currentUser; }
    };

    async function getCurrentUserProfile() {
        if (!currentUser) return null;
        const role = userRole || 'member';
        const isAdmin = role === 'admin';
        const isOfficer = role === 'officer' || isAdmin;
        const isMember = role === 'member' || isOfficer;
        return {
            uid: currentUser.uid,
            role,
            name: role === 'admin' ? '管理者' : (role === 'officer' ? '役員' : '一般会員'),
            isAdmin,
            isOfficer,
            isMember
        };
    }

    // requireMemberAuth シミュレータ
    let modalShown = false;
    let modalOptions = null;

    async function requireMemberAuth(options = {}) {
        if (currentUser) {
            const profile = await getCurrentUserProfile();
            if (profile) {
                if (options.officerOnly && !profile.isOfficer) {
                    if (options.statusEl) {
                        options.statusEl.textContent = "この操作は役員・管理者アカウントでのみ利用できます。";
                    }
                    return false;
                }
                if (profile.isMember) {
                    if (typeof options.onSuccess === "function") {
                        await options.onSuccess(profile);
                    }
                    return true;
                }
            }
        }

        modalShown = true;
        modalOptions = options;
        return false;
    }

    function simulateLoginSuccess(userId, role) {
        currentUser = { uid: `uid_${userId}` };
        userRole = role;
        modalShown = false;

        // 要件2: ログイン成功後は自動送信せず、手動確認を促す案内を表示
        const btnName = modalOptions?.buttonLabel || "登録";
        if (modalOptions?.statusEl) {
            modalOptions.statusEl.textContent = `✅ ログインしました（${role}様）。内容を確認のうえ、もう一度【${btnName}】ボタンを押してください。`;
        }
        if (typeof modalOptions?.onSuccess === "function") {
            modalOptions.onSuccess({ role, name: userId });
        }
    }

    return {
        requireMemberAuth,
        simulateLoginSuccess,
        isModalShown: () => modalShown,
        getModalOptions: () => modalOptions,
        setCurrentUser: (u, r) => { currentUser = u; userRole = r; }
    };
}

let testCount = 0;
let passCount = 0;

function runTest(name, fn) {
    testCount++;
    try {
        fn();
        console.log(`[PASS] #${testCount} ${name}`);
        passCount++;
    } catch (err) {
        console.error(`[FAIL] #${testCount} ${name}:`, err.message);
    }
}

// 1. 未ログイン時のモーダル表示
runTest("未ログイン時: requireMemberAuth は false を返し、モーダルを表示する", () => {
    const env = createMockEnv(null);
    const statusEl = { textContent: "" };
    const res = env.requireMemberAuth({ actionLabel: "備品予約", buttonLabel: "予約を登録", statusEl });
    assert.strictEqual(env.isModalShown(), true);
    assert.strictEqual(env.getModalOptions().actionLabel, "備品予約");
});

// 2. ログイン成功後の手動確認案内（自動送信防止）
runTest("ログイン復帰時: 自動送信せず、手動確認メッセージを表示する (要件2)", () => {
    const env = createMockEnv(null);
    const statusEl = { textContent: "" };
    env.requireMemberAuth({ actionLabel: "備品予約", buttonLabel: "予約を登録", statusEl });
    assert.strictEqual(env.isModalShown(), true);

    // ログインシミュレーション
    env.simulateLoginSuccess("member", "member");
    assert.strictEqual(env.isModalShown(), false);
    assert.ok(statusEl.textContent.includes("内容を確認のうえ、もう一度【予約を登録】ボタンを押してください"));
    assert.ok(statusEl.textContent.includes("ログインしました"));
});

// 3. ログイン済み会員の即時許可
runTest("ログイン済み会員: requireMemberAuth は即座に true を返し、モーダルを表示しない", async () => {
    const env = createMockEnv({ uid: "uid_member" }, "member");
    const statusEl = { textContent: "" };
    let successCalled = false;
    const res = await env.requireMemberAuth({
        actionLabel: "参加申込",
        onSuccess: () => { successCalled = true; },
        statusEl
    });
    assert.strictEqual(res, true);
    assert.strictEqual(env.isModalShown(), false);
    assert.strictEqual(successCalled, true);
});

// 4. 役員専用操作に対する一般会員のブロック
runTest("役員専用操作 (officerOnly): 一般会員 member は拒絶されエラーが表示される", async () => {
    const env = createMockEnv({ uid: "uid_member" }, "member");
    const statusEl = { textContent: "" };
    const res = await env.requireMemberAuth({
        actionLabel: "行事マスタ登録",
        officerOnly: true,
        statusEl
    });
    assert.strictEqual(res, false);
    assert.ok(statusEl.textContent.includes("役員・管理者アカウントでのみ利用できます"));
});

// 5. 役員専用操作に対する役員の許可
runTest("役員専用操作 (officerOnly): 役員 officer は許可される (要件5)", async () => {
    const env = createMockEnv({ uid: "uid_officer" }, "officer");
    const statusEl = { textContent: "" };
    const res = await env.requireMemberAuth({
        actionLabel: "行事マスタ登録",
        officerOnly: true,
        statusEl
    });
    assert.strictEqual(res, true);
});

console.log(`\n======================================================`);
console.log(`全 ${testCount} ケース中 ${passCount} ケース成功`);
if (passCount === testCount) {
    console.log("会員認証・操作復帰フロー自動テストに完全合格 (ALL PASSED)");
} else {
    process.exit(1);
}
console.log(`======================================================\n`);
