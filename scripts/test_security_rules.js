// scripts/test_security_rules.js
/**
 * Firestore Security Rules & ユーザーID認証アクセス制御マトリクス総合検証テスト (B方式 厳格版)
 *
 * 追加要件:
 *   1. users の本人更新では、role・username・管理用フィールドを変更できないようにする。
 *   2. communityEvents の申請者本人による更新では、status を pending に固定し、organizerUid の変更を禁止する。
 *   3. equipmentReservations の本人取消では、userUid と予約内容の変更を禁止し、status のみ cancelled に変更可能とする。
 *   4. 公開ファイル検査 (verify_public_files.js) と連携。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const configPath = path.resolve(__dirname, '../dist/js/runtime-config.js');
const rawCode = fs.readFileSync(configPath, 'utf8');
const cjsCode = rawCode.replace(/export const /g, 'exports.');
const sandbox = { window: {}, exports: {} };
vm.createContext(sandbox);
vm.runInContext(cjsCode, sandbox);
const AUTH_USER_MAP = sandbox.exports.AUTH_USER_MAP;

console.log('=== Firestore Security Rules B方式 (厳格認可・改ざん防止) 総合検証テスト開始 ===\n');

// -------------------------------------------------------------
// 1. ユーザーID解決 (resolveEmailFromUserId) テスト
// -------------------------------------------------------------
console.log('--- 1. ユーザーID解決 (resolveEmailFromUserId) テスト ---');
function resolveEmail(userId) {
    const raw = String(userId || '').trim();
    if (!raw) return null;
    if (raw.includes('@')) return raw;
    return AUTH_USER_MAP[raw.toLowerCase()] || null;
}

const idMappingTests = [
    { input: 'niina', expected: 'niina@wakamatsu-cho.internal' },
    { input: 'NIINA ', expected: 'niina@wakamatsu-cho.internal' },
    { input: 'officer', expected: 'officer@wakamatsu-cho.internal' },
    { input: 'OFFICER', expected: 'officer@wakamatsu-cho.internal' },
    { input: 'member', expected: 'member@wakamatsu-cho.internal' },
    { input: 'MEMBER ', expected: 'member@wakamatsu-cho.internal' },
    { input: 'admin@example.com', expected: 'admin@example.com' },
    { input: 'unknown_user', expected: null }
];

idMappingTests.forEach(({ input, expected }) => {
    const res = resolveEmail(input);
    const pass = res === expected;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] resolveEmail("${input}") => ${res} (期待値: ${expected})`);
    if (!pass) process.exit(1);
});

// -------------------------------------------------------------
// 2. B方式 Firestore Security Rules エミュレータ関数
// -------------------------------------------------------------
console.log('\n--- 2. B方式 Firestore Security Rules 4区分アクセス制御マトリクステスト ---');

const mockDatabase = {
    users: {
        'uid_niina': { username: 'niina', role: 'admin' },
        'uid_officer': { username: 'officer', role: 'officer' },
        'uid_member': { username: 'member', role: 'member' }
    }
};

function evaluateRuleB(ruleContext) {
    const { auth, resource, requestResource, path: docPath, method } = ruleContext;

    const isAuthenticated = auth !== null && auth.uid != null;

    function hasUserDoc() {
        return isAuthenticated && Boolean(mockDatabase.users[auth.uid]);
    }

    function getUserRole() {
        return hasUserDoc() ? mockDatabase.users[auth.uid].role : null;
    }

    const isAdmin = hasUserDoc() && getUserRole() === 'admin';
    const isOfficer = hasUserDoc() && (getUserRole() === 'officer' || getUserRole() === 'admin');
    const isMember = hasUserDoc() && (getUserRole() === 'member' || getUserRole() === 'officer' || getUserRole() === 'admin');
    const isOwner = (uid) => isAuthenticated && auth.uid === uid;

    // 未認証は全コレクションで読み書き不可 (要件1 & 2)
    if (!isAuthenticated) return false;

    // 1. 会員プロファイル (users/{userId})
    if (docPath.startsWith('users/')) {
        const userId = docPath.replace('users/', '');
        if (method === 'read') {
            return isOwner(userId) || isAdmin;
        }
        if (method === 'create') {
            return isAdmin;
        }
        if (method === 'update') {
            if (isAdmin) return true;
            if (isOwner(userId)) {
                // 追加要件1: role・username・管理用フィールド(email, permissions, isAdmin, isOfficer, status等)の変更禁止
                const protectedKeys = ['role', 'username', 'email', 'permissions', 'isAdmin', 'isOfficer', 'status'];
                const before = resource?.data || {};
                const after = requestResource?.data || {};
                const changedKeys = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
                const hasProtected = changedKeys.some(k => protectedKeys.includes(k));
                return !hasProtected;
            }
            return false;
        }
        if (method === 'delete') {
            return isAdmin;
        }
    }

    // 正当な会員登録(users)がない場合は後続コレクションへのアクセス不可
    if (!isMember) return false;

    // 2. 町内会公式行事 (events/{eventId})
    if (docPath.startsWith('events/')) {
        if (method === 'read') {
            const isPublished = resource?.data?.status === 'published';
            if (isMember && isPublished) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create' || method === 'update' || method === 'delete' || method === 'write') {
            return isOfficer;
        }
    }

    // 3. 会員企画イベント (communityEvents/{eventId})
    if (docPath.startsWith('communityEvents/')) {
        if (docPath.includes('/entries/')) {
            if (method === 'read') {
                return isOfficer || (isAuthenticated && resource?.data?.uid === auth.uid);
            }
            if (method === 'create') {
                return isMember && requestResource?.data?.uid === auth.uid;
            }
            if (method === 'update' || method === 'delete') {
                return isOfficer || (isAuthenticated && resource?.data?.uid === auth.uid);
            }
        }

        if (method === 'read') {
            const isApproved = resource?.data?.status === 'approved';
            if (isMember && isApproved) return true;
            if (isAuthenticated && resource?.data?.organizerUid === auth.uid) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create') {
            return isMember &&
                   requestResource?.data?.organizerUid === auth.uid &&
                   requestResource?.data?.status === 'pending';
        }
        if (method === 'update') {
            if (isOfficer) return true;
            if (isAuthenticated) {
                // 追加要件2: status を pending に固定し、organizerUid の変更を禁止
                const isMyEvent = resource?.data?.organizerUid === auth.uid;
                const uidUnchanged = requestResource?.data?.organizerUid === resource?.data?.organizerUid;
                const wasPending = resource?.data?.status === 'pending';
                const staysPending = requestResource?.data?.status === 'pending';
                return isMyEvent && uidUnchanged && wasPending && staysPending;
            }
            return false;
        }
        if (method === 'delete') {
            return isOfficer;
        }
    }

    // 4. 既存企画アーカイブ (eventPlanning/{docId})
    if (docPath.startsWith('eventPlanning/')) {
        return isOfficer;
    }

    // 5. 回覧板・資料室 (documents/{docId})
    if (docPath.startsWith('documents/')) {
        if (method === 'read') return isMember;
        if (method === 'create' || method === 'update' || method === 'delete' || method === 'write') {
            return isOfficer;
        }
    }

    // 6. 写真アルバム (photos/{photoId})
    if (docPath.startsWith('photos/')) {
        if (method === 'read') {
            const isApproved = resource?.data?.status === 'approved';
            if (isMember && isApproved) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create') {
            return isMember && requestResource?.data?.status === 'pending';
        }
        if (method === 'update' || method === 'delete') {
            return isOfficer;
        }
    }

    // 7. 備品マスタ (equipmentMaster/{equipmentId})
    if (docPath.startsWith('equipmentMaster/')) {
        if (method === 'read') return isMember;
        return isOfficer;
    }

    // 8. 備品予約台帳 (equipmentReservations/{reservationId})
    if (docPath.startsWith('equipmentReservations/')) {
        if (method === 'read') return isMember;
        if (method === 'create') {
            return isMember &&
                   requestResource?.data?.userUid === auth.uid &&
                   requestResource?.data?.status === 'requested';
        }
        if (method === 'update') {
            if (isOfficer) return true;
            if (isAuthenticated) {
                // 追加要件3: userUid と予約内容の変更を禁止し、status のみ cancelled に変更可能とする
                const isMyRes = resource?.data?.userUid === auth.uid;
                const uidUnchanged = requestResource?.data?.userUid === resource?.data?.userUid;
                const isCancelling = requestResource?.data?.status === 'cancelled';
                const before = resource?.data || {};
                const after = requestResource?.data || {};
                const changedKeys = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
                const onlyStatusAndTs = changedKeys.every(k => k === 'status' || k === 'updatedAt');
                return isMyRes && uidUnchanged && isCancelling && onlyStatusAndTs;
            }
            return false;
        }
        if (method === 'delete') {
            return isOfficer;
        }
    }

    // 9. 意見交換・相談 (opinions/{opinionId})
    if (docPath.startsWith('opinions/')) {
        if (method === 'read') {
            if (isMember && resource?.data?.isPublic === true) return true;
            if (isAuthenticated && resource?.data?.userUid === auth.uid) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create') {
            return isMember && requestResource?.data?.userUid === auth.uid;
        }
        if (method === 'update' || method === 'delete') {
            return isOfficer;
        }
    }

    // 10. 未定義コレクションは全拒否
    return false;
}

// -------------------------------------------------------------
// 3. テストマトリクス定義
// -------------------------------------------------------------
const authGuest = null;
const authMember = { uid: 'uid_member' };
const authOfficer = { uid: 'uid_officer' };
const authAdmin = { uid: 'uid_niina' };

const tests = [
    // [未ログイン遮断]
    {
        name: '未ログイン: 公式行事(events)閲覧拒絶',
        ctx: { auth: authGuest, path: 'events/ev1', method: 'read', resource: { data: { status: 'published' } } },
        expected: false
    },
    {
        name: '未ログイン: 回覧板(documents)閲覧拒絶',
        ctx: { auth: authGuest, path: 'documents/doc1', method: 'read' },
        expected: false
    },
    {
        name: '未ログイン: 備品予約申請拒絶',
        ctx: { auth: authGuest, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'requested' } } },
        expected: false
    },

    // [追加要件1: users 本人更新での role・username・管理フィールド変更禁止]
    {
        name: 'member: 自身の users 参照許可',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'read' },
        expected: true
    },
    {
        name: 'member: 他人の users 参照拒絶',
        ctx: { auth: authMember, path: 'users/uid_officer', method: 'read' },
        expected: false
    },
    {
        name: 'member: 自身の role 変更試行の拒絶 (追加要件1)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'officer', username: 'member' } } },
        expected: false
    },
    {
        name: 'member: 自身の username 変更試行の拒絶 (追加要件1)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'member', username: 'hacker' } } },
        expected: false
    },
    {
        name: 'member: 自身の email 変更試行の拒絶 (追加要件1)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member', email: 'old@ex.com' } }, requestResource: { data: { role: 'member', username: 'member', email: 'new@ex.com' } } },
        expected: false
    },
    {
        name: 'member: 自身の 管理用フィールド(permissions) 変更試行の拒絶 (追加要件1)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'member', username: 'member', permissions: ['all'] } } },
        expected: false
    },
    {
        name: 'member: 自身の 表示名・電話番号(一般プロファイル) 変更許可 (追加要件1)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member', name: '旧名' } }, requestResource: { data: { role: 'member', username: 'member', name: '新名' } } },
        expected: true
    },
    {
        name: 'admin: 会員の role・username 変更許可 (管理者特権)',
        ctx: { auth: authAdmin, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'officer', username: 'officer_new' } } },
        expected: true
    },

    // [追加要件2: communityEvents 申請者本人更新での status=pending固定 & organizerUid変更禁止]
    {
        name: 'member: 企画申請作成 (status=pending, organizerUid=auth.uid) 許可',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_member', status: 'pending' } } },
        expected: true
    },
    {
        name: 'member: 企画申請作成時に他人のUIDを指定するのを拒絶',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_other', status: 'pending' } } },
        expected: false
    },
    {
        name: 'member: 自身が企画した pending 企画の内容更新 (status=pending, organizerUid不変) 許可 (追加要件2)',
        ctx: { auth: authMember, path: 'communityEvents/c1', method: 'update', resource: { data: { organizerUid: 'uid_member', status: 'pending', title: '旧題' } }, requestResource: { data: { organizerUid: 'uid_member', status: 'pending', title: '新題' } } },
        expected: true
    },
    {
        name: 'member: 自身が企画した pending 企画の organizerUid 変更試行を拒絶 (追加要件2)',
        ctx: { auth: authMember, path: 'communityEvents/c1', method: 'update', resource: { data: { organizerUid: 'uid_member', status: 'pending' } }, requestResource: { data: { organizerUid: 'uid_other', status: 'pending' } } },
        expected: false
    },
    {
        name: 'member: 自身が企画した pending 企画の status を勝手に approved に昇格試行するのを拒絶 (追加要件2)',
        ctx: { auth: authMember, path: 'communityEvents/c1', method: 'update', resource: { data: { organizerUid: 'uid_member', status: 'pending' } }, requestResource: { data: { organizerUid: 'uid_member', status: 'approved' } } },
        expected: false
    },
    {
        name: 'officer: 企画の承認 (status を approved へ更新) 許可',
        ctx: { auth: authOfficer, path: 'communityEvents/c1', method: 'update', resource: { data: { status: 'pending' } }, requestResource: { data: { status: 'approved' } } },
        expected: true
    },

    // [追加要件3: equipmentReservations 本人取消での userUid・予約内容変更禁止 & status=cancelled のみ許可]
    {
        name: 'member: 備品予約申請 (status=requested, userUid=auth.uid) 許可',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { userUid: 'uid_member', status: 'requested', equipmentId: 'tent' } } },
        expected: true
    },
    {
        name: 'member: 自身の予約のステータスのみ cancelled へ取消更新許可 (追加要件3)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested', equipmentId: 'tent', quantity: 2 } }, requestResource: { data: { userUid: 'uid_member', status: 'cancelled', equipmentId: 'tent', quantity: 2, updatedAt: '2026-11-08' } } },
        expected: true
    },
    {
        name: 'member: 予約取消時に userUid を他人に変更試行するのを拒絶 (追加要件3)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested' } }, requestResource: { data: { userUid: 'uid_other', status: 'cancelled' } } },
        expected: false
    },
    {
        name: 'member: 予約取消時に予約内容(機材・数量・日程)を変更試行するのを拒絶 (追加要件3: 予約内容改ざん禁止)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested', equipmentId: 'tent', quantity: 2 } }, requestResource: { data: { userUid: 'uid_member', status: 'cancelled', equipmentId: 'mower', quantity: 5 } } },
        expected: false
    },
    {
        name: 'member: 自身の予約ステータスを勝手に approved に変更試行するのを拒絶 (追加要件3)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested' } }, requestResource: { data: { userUid: 'uid_member', status: 'approved' } } },
        expected: false
    },
    {
        name: 'officer: 予約ステータスの承認 (approved) 更新許可',
        ctx: { auth: authOfficer, path: 'equipmentReservations/res1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },

    // [個人情報保護・その他業務データ]
    {
        name: 'member: 自身の参加台帳参照許可',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e1', method: 'read', resource: { data: { uid: 'uid_member' } } },
        expected: true
    },
    {
        name: 'member: 他人の参加台帳参照拒絶 (個人情報保護)',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e2', method: 'read', resource: { data: { uid: 'uid_other' } } },
        expected: false
    },
    {
        name: 'member: 企画アーカイブ(eventPlanning)参照拒絶 (役員専用)',
        ctx: { auth: authMember, path: 'eventPlanning/p1', method: 'read' },
        expected: false
    },
    {
        name: 'member: 回覧板資料(documents)閲覧許可 (B方式)',
        ctx: { auth: authMember, path: 'documents/doc1', method: 'read' },
        expected: true
    },
    {
        name: 'officer: 資料(documents)アップロード許可',
        ctx: { auth: authOfficer, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '総会' } } },
        expected: true
    },
    {
        name: 'member: 自身の意見送信許可',
        ctx: { auth: authMember, path: 'opinions/op1', method: 'create', requestResource: { data: { userUid: 'uid_member' } } },
        expected: true
    },
    {
        name: '全ユーザー: 未定義コレクションへのアクセス拒絶',
        ctx: { auth: authAdmin, path: 'unknown_coll/doc1', method: 'read' },
        expected: false
    }
];

let failed = 0;
tests.forEach((t, i) => {
    const result = evaluateRuleB(t.ctx);
    const pass = result === t.expected;
    const badge = pass ? '[PASS]' : '[FAIL]';
    if (!pass) failed++;
    console.log(`${badge} #${String(i + 1).padStart(2, '0')} ${t.name}: 期待値=${t.expected ? 'ALLOW' : 'DENY'}, 結果=${result ? 'ALLOW' : 'DENY'}`);
});

console.log('\n======================================================');
if (failed === 0) {
    console.log(`全 ${tests.length} ケースのB方式厳格セキュリティルール検証に完全合格 (ALL PASSED)`);
} else {
    console.error(`${failed} 件のテストが失敗しました`);
    process.exit(1);
}
console.log('======================================================\n');
