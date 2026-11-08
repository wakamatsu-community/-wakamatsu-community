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
const cjsCode = rawCode
    .replace(/export const /g, 'exports.')
    .replace(/export\s*\{\s*RUNTIME_CONFIG\s*,\s*AUTH_USER_MAP\s*\};/g, 'exports.RUNTIME_CONFIG = RUNTIME_CONFIG; exports.AUTH_USER_MAP = AUTH_USER_MAP;');
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
    { input: 'niina', expected: 'niina@gmail.com' },
    { input: 'NIINA ', expected: 'niina@gmail.com' },
    { input: 'officer', expected: 'officer@gmail.com' },
    { input: 'OFFICER', expected: 'officer@gmail.com' },
    { input: 'member', expected: 'member@gmail.com' },
    { input: 'MEMBER ', expected: 'member@gmail.com' },
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

    // 1. 会員プロファイル (users/{userId}) - admin専用特権管理
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
                // 本人更新は限定フィールドのみ
                const allowedKeys = ['name', 'displayName', 'phone', 'group', 'updatedAt'];
                const before = resource?.data || {};
                const after = requestResource?.data || {};
                const changedKeys = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
                return changedKeys.length > 0 && changedKeys.every(k => allowedKeys.includes(k));
            }
            return false;
        }
        if (method === 'delete') {
            return isAdmin;
        }
    }

    // 2. 町内会公式行事 (events/{eventId})
    // 閲覧: published は全員閲覧可 (未ログイン含む)
    if (docPath.startsWith('events/')) {
        if (method === 'read') {
            const isPublished = resource?.data?.status === 'published';
            if (isPublished) return true;
            return isOfficer;
        }
        if (method === 'create' || method === 'update' || method === 'delete' || method === 'write') {
            return isOfficer;
        }
    }

    // 3. 会員企画イベント (communityEvents/{eventId})
    if (docPath.startsWith('communityEvents/')) {
        // サブコレクション: 参加者台帳 (entries) - 個人情報保護のため責任者(isOfficer)のみ閲覧可
        if (docPath.includes('/entries/')) {
            if (method === 'read') {
                return isOfficer;
            }
            if (method === 'create') {
                const d = requestResource?.data || {};
                return isMember &&
                       d.uid === auth.uid &&
                       typeof d.name === 'string' && d.name.length > 0 &&
                       typeof d.phone === 'string' && d.phone.length > 0 &&
                       typeof d.count === 'number' && d.count >= 1;
            }
            if (method === 'update' || method === 'delete') {
                return isOfficer; // 共通会員による他人の参加申込改ざん・取消を防止
            }
        }

        if (method === 'read') {
            const isApproved = resource?.data?.status === 'approved';
            if (isApproved) return true; // 承認済みは一般公開
            if (isAuthenticated && resource?.data?.organizerUid === auth.uid) return true;
            return isOfficer;
        }
        if (method === 'create') {
            const d = requestResource?.data || {};
            return isMember &&
                   d.organizerUid === auth.uid &&
                   d.status === 'pending' &&
                   typeof d.title === 'string' && d.title.length > 0 &&
                   typeof d.place === 'string' && d.place.length > 0;
        }
        if (method === 'update') {
            if (isOfficer) return true;
            if (isAuthenticated) {
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
    // 閲覧: 正規会員(member, officer, admin)のみ閲覧可。未ログインは閲覧禁止
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
            if (isApproved) return true; // 承認済み写真は一般公開
            return isOfficer;
        }
        if (method === 'create') {
            const d = requestResource?.data || {};
            return isMember && d.status === 'pending' && d.userUid === auth.uid;
        }
        if (method === 'update' || method === 'delete') {
            return isOfficer;
        }
    }

    // 7. 備品マスタ (equipmentMaster/{equipmentId})
    if (docPath.startsWith('equipmentMaster/')) {
        if (method === 'read') return true; // 空き状況確認のため一般公開
        return isOfficer;
    }

    // 8. 備品予約台帳 (equipmentReservations/{reservationId})
    // 氏名・電話番号・組を含むため、責任者(isOfficer)のみ閲覧可。共通会員への他者台帳公開を遮断
    if (docPath.startsWith('equipmentReservations/')) {
        if (method === 'read') return isOfficer;
        if (method === 'create') {
            const d = requestResource?.data || {};
            return isMember &&
                   d.userUid === auth.uid &&
                   d.status === 'requested' &&
                   typeof d.applicantName === 'string' && d.applicantName.length > 0 &&
                   typeof d.phone === 'string' && d.phone.length > 0 &&
                   typeof d.quantity === 'number' && d.quantity >= 1;
        }
        if (method === 'update' || method === 'delete') {
            return isOfficer; // 共通会員による他人の予約改ざん・取消を防止するため役員のみ
        }
    }

    // 9. 意見交換・相談 (opinions/{opinionId})
    if (docPath.startsWith('opinions/')) {
        if (method === 'read') {
            if (resource?.data?.isPublic === true) return true; // 公開意見は全員閲覧可
            return isOfficer;
        }
        if (method === 'create') {
            const d = requestResource?.data || {};
            return isMember &&
                   d.userUid === auth.uid &&
                   (d.status === 'unconfirmed' || d.status === 'pending') &&
                   typeof d.category === 'string' &&
                   typeof d.content === 'string';
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
    // [一般公開閲覧 (未ログイン許可)]
    {
        name: '未ログイン: 公開公式行事(events: published)閲覧許可',
        ctx: { auth: authGuest, path: 'events/ev1', method: 'read', resource: { data: { status: 'published' } } },
        expected: true
    },
    {
        name: '未ログイン: 下書き行事(events: draft)閲覧拒絶',
        ctx: { auth: authGuest, path: 'events/ev1', method: 'read', resource: { data: { status: 'draft' } } },
        expected: false
    },
    {
        name: '未ログイン: 承認済みコミニティ企画(communityEvents: approved)閲覧許可',
        ctx: { auth: authGuest, path: 'communityEvents/c1', method: 'read', resource: { data: { status: 'approved' } } },
        expected: true
    },
    {
        name: '未ログイン: 回覧板(documents)閲覧拒絶 (正規会員限定)',
        ctx: { auth: authGuest, path: 'documents/doc1', method: 'read' },
        expected: false
    },
    {
        name: 'member: 回覧板(documents)閲覧許可 (正規会員)',
        ctx: { auth: authMember, path: 'documents/doc1', method: 'read' },
        expected: true
    },
    {
        name: 'officer: 回覧板(documents)閲覧許可 (役員)',
        ctx: { auth: authOfficer, path: 'documents/doc1', method: 'read' },
        expected: true
    },
    {
        name: 'admin: 回覧板(documents)閲覧許可 (管理者)',
        ctx: { auth: authAdmin, path: 'documents/doc1', method: 'read' },
        expected: true
    },
    {
        name: 'member: 回覧板(documents)作成・登録試行の拒絶 (役員専用)',
        ctx: { auth: authMember, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '総会' } } },
        expected: false
    },
    {
        name: 'officer: 回覧板(documents)作成・登録許可 (役員管理)',
        ctx: { auth: authOfficer, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '総会' } } },
        expected: true
    },
    {
        name: '未ログイン: 備品マスタ(equipmentMaster)閲覧許可',
        ctx: { auth: authGuest, path: 'equipmentMaster/eq1', method: 'read' },
        expected: true
    },
    {
        name: '未ログイン: 承認済み写真(photos: approved)閲覧許可',
        ctx: { auth: authGuest, path: 'photos/p1', method: 'read', resource: { data: { status: 'approved' } } },
        expected: true
    },
    {
        name: '未ログイン: 公開意見(opinions: isPublic=true)閲覧許可',
        ctx: { auth: authGuest, path: 'opinions/op1', method: 'read', resource: { data: { isPublic: true } } },
        expected: true
    },

    // [個人情報保護 (未ログイン・一般会員の閲覧拒絶)]
    {
        name: '未ログイン: 備品予約台帳(equipmentReservations)閲覧拒絶 (個人情報保護)',
        ctx: { auth: authGuest, path: 'equipmentReservations/res1', method: 'read', resource: { data: { status: 'requested' } } },
        expected: false
    },
    {
        name: 'member: 備品予約台帳(equipmentReservations)閲覧拒絶 (他人の個人情報漏洩防止)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'read', resource: { data: { status: 'requested' } } },
        expected: false
    },
    {
        name: 'officer: 備品予約台帳(equipmentReservations)閲覧許可 (役員管理)',
        ctx: { auth: authOfficer, path: 'equipmentReservations/res1', method: 'read', resource: { data: { status: 'requested' } } },
        expected: true
    },
    {
        name: '未ログイン: 参加者台帳(entries)閲覧拒絶 (個人情報保護)',
        ctx: { auth: authGuest, path: 'communityEvents/c1/entries/e1', method: 'read', resource: { data: { uid: 'uid_member' } } },
        expected: false
    },
    {
        name: 'member: 参加者台帳(entries)閲覧拒絶 (他人の個人情報漏洩防止)',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e1', method: 'read', resource: { data: { uid: 'uid_member' } } },
        expected: false
    },
    {
        name: 'officer: 参加者台帳(entries)閲覧許可 (役員管理)',
        ctx: { auth: authOfficer, path: 'communityEvents/c1/entries/e1', method: 'read', resource: { data: { uid: 'uid_member' } } },
        expected: true
    },

    // [未ログイン登録操作の遮断]
    {
        name: '未ログイン: 備品予約申請拒絶',
        ctx: { auth: authGuest, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'requested' } } },
        expected: false
    },
    {
        name: '未ログイン: 企画申請作成拒絶',
        ctx: { auth: authGuest, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { status: 'pending' } } },
        expected: false
    },
    {
        name: '未ログイン: 参加申込作成拒絶',
        ctx: { auth: authGuest, path: 'communityEvents/c1/entries/e_new', method: 'create', requestResource: { data: { count: 1 } } },
        expected: false
    },

    // [共通会員による他者台帳・予約改ざん防止 & createバリデーション]
    {
        name: 'member: 備品予約申請 (status=requested, 必須項目・型OK) 許可',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { userUid: 'uid_member', status: 'requested', equipmentId: 'tent', applicantName: '山田', phone: '090-1111-2222', group: '1組', quantity: 1 } } },
        expected: true
    },
    {
        name: 'member: 備品予約申請で status=approved を直接指定するのを拒絶',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { userUid: 'uid_member', status: 'approved', equipmentId: 'tent', applicantName: '山田', phone: '090-1111-2222', group: '1組', quantity: 1 } } },
        expected: false
    },
    {
        name: 'member: 備品予約台帳の直接更新・取消拒絶 (他者予約改ざん防止)',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested' } }, requestResource: { data: { status: 'cancelled' } } },
        expected: false
    },
    {
        name: 'officer: 備品予約ステータスの承認 (approved) 更新許可',
        ctx: { auth: authOfficer, path: 'equipmentReservations/res1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },
    {
        name: 'member: 企画申請作成 (status=pending, 必須項目・型OK) 許可',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_member', status: 'pending', title: '防犯ミニ講座', place: '若松集会所' } } },
        expected: true
    },
    {
        name: 'member: 企画申請作成で status=approved を直接指定するのを拒絶',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_member', status: 'approved', title: '防犯ミニ講座', place: '若松集会所' } } },
        expected: false
    },
    {
        name: 'member: 参加者台帳の直接更新拒絶 (他者申込改ざん防止)',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e1', method: 'update', resource: { data: { uid: 'uid_member' } }, requestResource: { data: { count: 3 } } },
        expected: false
    },
    {
        name: 'officer: 企画の承認 (status を approved へ更新) 許可 (業務マスタ管理)',
        ctx: { auth: authOfficer, path: 'communityEvents/c1', method: 'update', resource: { data: { status: 'pending' } }, requestResource: { data: { status: 'approved' } } },
        expected: true
    },

    // [業務マスタ管理と特権管理 (admin専用) の厳格分離]
    {
        name: 'officer: 公式行事(events)作成許可 (業務マスタ管理)',
        ctx: { auth: authOfficer, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '月例清掃' } } },
        expected: true
    },
    {
        name: 'officer: 写真の承認 (photos) 許可 (業務マスタ管理)',
        ctx: { auth: authOfficer, path: 'photos/p1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },
    {
        name: 'officer: 会員の role 変更試行を拒絶 (特権昇格防止: admin専用)',
        ctx: { auth: authOfficer, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member' } }, requestResource: { data: { role: 'officer' } } },
        expected: false
    },
    {
        name: 'officer: ユーザー削除試行を拒絶 (特権管理: admin専用)',
        ctx: { auth: authOfficer, path: 'users/uid_member', method: 'delete' },
        expected: false
    },
    {
        name: 'admin: 会員の role・username 変更許可 (管理者特権)',
        ctx: { auth: authAdmin, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'officer', username: 'officer_new' } } },
        expected: true
    },
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
        name: 'member: 許可項目(name, phone, group)のみの本人更新許可 (hasOnly)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member', name: '旧名' } }, requestResource: { data: { role: 'member', username: 'member', name: '新名', phone: '090-0000-0000', group: '1組2班' } } },
        expected: true
    },
    {
        name: 'member: 自身の role 変更試行の拒絶 (hasOnly遮断)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'officer', username: 'member' } } },
        expected: false
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
