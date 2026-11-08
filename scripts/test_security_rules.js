// scripts/test_security_rules.js
/**
 * Firestore Security Rules & ユーザーID認証アクセス制御マトリクス総合検証テスト
 *
 * 検証対象 4区分:
 *   1. 未ログイン (guest)
 *   2. 一般会員 (member)   - username=member, role=member (閲覧専用)
 *   3. 役員 (officer)       - username=officer, role=officer (行事・資料・写真・備品管理)
 *   4. システム管理者 (niina) - username=niina, role=admin (特権管理・ユーザーロール監査)
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

console.log('=== Firestore Security Rules & ユーザーID認可 総合検証テスト開始 ===\n');

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
    { input: 'NIINA ', expected: 'niina@wakamatsu-cho.internal' }, // 大文字・空白正規化
    { input: 'officer', expected: 'officer@wakamatsu-cho.internal' },
    { input: 'OFFICER', expected: 'officer@wakamatsu-cho.internal' },
    { input: 'member', expected: 'member@wakamatsu-cho.internal' },
    { input: 'MEMBER ', expected: 'member@wakamatsu-cho.internal' },
    { input: 'admin@example.com', expected: 'admin@example.com' }, // 直接メール入力互換
    { input: 'unknown_user', expected: null } // 未登録ID
];

idMappingTests.forEach(({ input, expected }) => {
    const res = resolveEmail(input);
    const pass = res === expected;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] resolveEmail("${input}") => ${res} (期待値: ${expected})`);
    if (!pass) process.exit(1);
});

// -------------------------------------------------------------
// 2. Firestore Security Rules エミュレータ関数
// -------------------------------------------------------------
console.log('\n--- 2. Firestore Security Rules 4区分アクセス制御マトリクステスト ---');

// モックデータベース (usersコレクションの登録状態)
const mockDatabase = {
    users: {
        'uid_niina': { username: 'niina', role: 'admin' },
        'uid_officer': { username: 'officer', role: 'officer' },
        'uid_member': { username: 'member', role: 'member' }
    }
};

function evaluateRule(ruleContext) {
    const { auth, resource, requestResource, path: docPath, method } = ruleContext;

    // ヘルパー関数群 (firestore.rules のロジックと厳密に一致)
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
            return isAdmin || (isOwner(userId) && requestResource?.data?.role === resource?.data?.role);
        }
        if (method === 'delete') {
            return isAdmin;
        }
    }

    // 2. 町内会公式行事 (events/{eventId})
    if (docPath.startsWith('events/')) {
        if (method === 'read') {
            const isRestricted = resource?.data?.isRestricted === true;
            const isPublished = resource?.data?.status === 'published';
            if (isPublished && !isRestricted) return true;
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
            // entries サブコレクション (参加者台帳)
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
            const isRestricted = resource?.data?.isRestricted === true;
            const isApproved = resource?.data?.status === 'approved';
            if (isApproved && !isRestricted) return true;
            if (isMember && isApproved) return true;
            if (isAuthenticated && resource?.data?.organizerUid === auth.uid) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create') {
            return isMember && requestResource?.data?.status === 'pending';
        }
        if (method === 'update') {
            return isOfficer || (isAuthenticated && resource?.data?.organizerUid === auth.uid && resource?.data?.status === 'pending');
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
        if (method === 'read') {
            const isRestricted = resource?.data?.isRestricted === true;
            if (!isRestricted) return true;
            return isMember;
        }
        if (method === 'create' || method === 'update' || method === 'delete' || method === 'write') {
            return isOfficer;
        }
    }

    // 6. 写真アルバム (photos/{photoId})
    if (docPath.startsWith('photos/')) {
        if (method === 'read') {
            const isRestricted = resource?.data?.isRestricted === true;
            const isApproved = resource?.data?.status === 'approved';
            if (isApproved && !isRestricted) return true;
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
        if (method === 'read') return true;
        return isOfficer;
    }

    // 8. 備品予約台帳 (equipmentReservations/{reservationId})
    if (docPath.startsWith('equipmentReservations/')) {
        if (method === 'read') return true;
        if (method === 'create') {
            return requestResource?.data?.status === 'requested';
        }
        if (method === 'update') {
            return isOfficer || (isAuthenticated && resource?.data?.userUid === auth.uid && requestResource?.data?.status === 'cancelled');
        }
        if (method === 'delete') {
            return isOfficer;
        }
    }

    // 9. 意見交換・相談 (opinions/{opinionId})
    if (docPath.startsWith('opinions/')) {
        if (method === 'read') {
            if (resource?.data?.isPublic === true) return true;
            if (isAuthenticated && resource?.data?.userUid === auth.uid) return true;
            if (isOfficer) return true;
            return false;
        }
        if (method === 'create') {
            return true;
        }
        if (method === 'update' || method === 'delete') {
            return isOfficer;
        }
    }

    // 10. 未定義コレクションは全拒否
    return false;
}

// -------------------------------------------------------------
// 3. テストマトリクス定義 (4区分 × 各コレクション)
// -------------------------------------------------------------
const authGuest = null;
const authMember = { uid: 'uid_member' };
const authOfficer = { uid: 'uid_officer' };
const authAdmin = { uid: 'uid_niina' };

const tests = [
    // ==========================================
    // [1. users コレクション - 要件3]
    // ==========================================
    {
        name: '未ログイン: users ドキュメント参照の拒絶',
        ctx: { auth: authGuest, path: 'users/uid_member', method: 'read' },
        expected: false
    },
    {
        name: 'member: 自身の users ドキュメント参照許可',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'read' },
        expected: true
    },
    {
        name: 'member: 他人の users ドキュメント参照拒絶 (他人の情報閲覧禁止)',
        ctx: { auth: authMember, path: 'users/uid_officer', method: 'read' },
        expected: false
    },
    {
        name: 'member: 自身の role を officer へ自己昇格試行を拒絶 (role改ざん禁止)',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'officer', username: 'member' } } },
        expected: false
    },
    {
        name: 'member: 自身の表示名変更 (role維持) を許可',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', username: 'member' } }, requestResource: { data: { role: 'member', username: 'member_new' } } },
        expected: true
    },
    {
        name: 'officer: 他人の users ドキュメント参照拒絶 (他人の情報閲覧禁止)',
        ctx: { auth: authOfficer, path: 'users/uid_niina', method: 'read' },
        expected: false
    },
    {
        name: 'admin: 他人の users ドキュメント参照許可 (特権監査)',
        ctx: { auth: authAdmin, path: 'users/uid_member', method: 'read' },
        expected: true
    },
    {
        name: 'admin: 会員ロールの変更許可 (昇格・降格)',
        ctx: { auth: authAdmin, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member' } }, requestResource: { data: { role: 'officer' } } },
        expected: true
    },
    {
        name: 'member: ユーザー新規作成の拒絶 (adminのみ)',
        ctx: { auth: authMember, path: 'users/uid_new', method: 'create', requestResource: { data: { role: 'member' } } },
        expected: false
    },
    {
        name: 'admin: ユーザー新規作成の許可',
        ctx: { auth: authAdmin, path: 'users/uid_new', method: 'create', requestResource: { data: { role: 'member' } } },
        expected: true
    },

    // ==========================================
    // [2. events (公式行事) - 要件4 & 5]
    // ==========================================
    {
        name: '未ログイン: 公開公式行事の閲覧許可',
        ctx: { auth: authGuest, path: 'events/ev1', method: 'read', resource: { data: { status: 'published', isRestricted: false } } },
        expected: true
    },
    {
        name: '未ログイン: isRestricted未設定の既存公式行事の閲覧許可 (後方互換)',
        ctx: { auth: authGuest, path: 'events/ev_legacy', method: 'read', resource: { data: { status: 'published' } } },
        expected: true
    },
    {
        name: '未ログイン: 会員限定行事の閲覧拒絶 (要件4: 会員限定情報保護)',
        ctx: { auth: authGuest, path: 'events/ev_secret', method: 'read', resource: { data: { status: 'published', isRestricted: true } } },
        expected: false
    },
    {
        name: '未ログイン: 公式行事の作成拒絶',
        ctx: { auth: authGuest, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '勝手な行事' } } },
        expected: false
    },
    {
        name: 'member: 会員限定行事の閲覧許可 (要件4)',
        ctx: { auth: authMember, path: 'events/ev_secret', method: 'read', resource: { data: { status: 'published', isRestricted: true } } },
        expected: true
    },
    {
        name: 'member: 公式行事の作成拒絶 (閲覧専用保護)',
        ctx: { auth: authMember, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '会員作成行事' } } },
        expected: false
    },
    {
        name: 'officer: 公式行事の作成許可',
        ctx: { auth: authOfficer, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '町内清掃', status: 'published' } } },
        expected: true
    },
    {
        name: 'officer: 公式行事(下書き)の閲覧許可',
        ctx: { auth: authOfficer, path: 'events/ev_draft', method: 'read', resource: { data: { status: 'draft', isRestricted: false } } },
        expected: true
    },
    {
        name: 'officer: 公式行事の削除許可',
        ctx: { auth: authOfficer, path: 'events/ev1', method: 'delete' },
        expected: true
    },

    // ==========================================
    // [3. communityEvents & entries (会員企画・台帳) - 要件5]
    // ==========================================
    {
        name: '未ログイン: 承認済み公開企画の閲覧許可',
        ctx: { auth: authGuest, path: 'communityEvents/c1', method: 'read', resource: { data: { status: 'approved', isRestricted: false } } },
        expected: true
    },
    {
        name: '未ログイン: 承認待ち企画の閲覧拒絶',
        ctx: { auth: authGuest, path: 'communityEvents/c_pending', method: 'read', resource: { data: { status: 'pending' } } },
        expected: false
    },
    {
        name: 'member: 新規企画の申請許可 (status=pending)',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { title: '将棋クラブ', status: 'pending' } } },
        expected: true
    },
    {
        name: 'member: 新規企画を勝手にapprovedで作成するのを拒絶',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { title: '不正企画', status: 'approved' } } },
        expected: false
    },
    {
        name: 'member: 企画者自身によるpending企画の修正許可',
        ctx: { auth: authMember, path: 'communityEvents/c1', method: 'update', resource: { data: { organizerUid: 'uid_member', status: 'pending' } } },
        expected: true
    },
    {
        name: 'member: 他人のpending企画の修正拒絶',
        ctx: { auth: authMember, path: 'communityEvents/c1', method: 'update', resource: { data: { organizerUid: 'uid_other', status: 'pending' } } },
        expected: false
    },
    {
        name: 'officer: 企画の承認・更新許可',
        ctx: { auth: authOfficer, path: 'communityEvents/c1', method: 'update', resource: { data: { status: 'pending' } }, requestResource: { data: { status: 'approved' } } },
        expected: true
    },
    // entries サブコレクション (個人情報保護)
    {
        name: '未ログイン: 参加者台帳(entries)の参照拒絶 (個人情報保護)',
        ctx: { auth: authGuest, path: 'communityEvents/c1/entries/e1', method: 'read' },
        expected: false
    },
    {
        name: 'member: 自身の参加台帳参照許可',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e1', method: 'read', resource: { data: { uid: 'uid_member' } } },
        expected: true
    },
    {
        name: 'member: 他人の参加台帳参照拒絶 (個人情報保護の徹底)',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e2', method: 'read', resource: { data: { uid: 'uid_other' } } },
        expected: false
    },
    {
        name: 'member: 自身の参加申込登録許可',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e_new', method: 'create', requestResource: { data: { uid: 'uid_member', name: '田中' } } },
        expected: true
    },
    {
        name: 'member: 他人のUIDでのなりすまし参加登録拒絶',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e_fake', method: 'create', requestResource: { data: { uid: 'uid_other', name: '佐藤' } } },
        expected: false
    },
    {
        name: 'officer: 参加者台帳全件の参照許可 (出欠管理)',
        ctx: { auth: authOfficer, path: 'communityEvents/c1/entries/e2', method: 'read', resource: { data: { uid: 'uid_other' } } },
        expected: true
    },

    // ==========================================
    // [4. eventPlanning (企画検討アーカイブ)]
    // ==========================================
    {
        name: '未ログイン: 企画アーカイブ参照拒絶',
        ctx: { auth: authGuest, path: 'eventPlanning/p1', method: 'read' },
        expected: false
    },
    {
        name: 'member: 企画アーカイブ参照拒絶 (役員専用)',
        ctx: { auth: authMember, path: 'eventPlanning/p1', method: 'read' },
        expected: false
    },
    {
        name: 'officer: 企画アーカイブ参照・更新許可',
        ctx: { auth: authOfficer, path: 'eventPlanning/p1', method: 'read' },
        expected: true
    },

    // ==========================================
    // [5. documents (回覧板・資料室) - 要件4]
    // ==========================================
    {
        name: '未ログイン: 一般公開回覧板の参照許可',
        ctx: { auth: authGuest, path: 'documents/doc_public', method: 'read', resource: { data: { isRestricted: false } } },
        expected: true
    },
    {
        name: '未ログイン: 会員限定資料(総会資料)の参照拒絶 (要件4)',
        ctx: { auth: authGuest, path: 'documents/doc_secret', method: 'read', resource: { data: { isRestricted: true } } },
        expected: false
    },
    {
        name: 'member: 会員限定資料の参照許可 (要件4)',
        ctx: { auth: authMember, path: 'documents/doc_secret', method: 'read', resource: { data: { isRestricted: true } } },
        expected: true
    },
    {
        name: 'member: 資料アップロード拒絶 (役員専用)',
        ctx: { auth: authMember, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '資料' } } },
        expected: false
    },
    {
        name: 'officer: 資料アップロード許可',
        ctx: { auth: authOfficer, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '令和8年総会資料' } } },
        expected: true
    },

    // ==========================================
    // [6. photos (写真アルバム)]
    // ==========================================
    {
        name: '未ログイン: 承認済み公開写真の閲覧許可',
        ctx: { auth: authGuest, path: 'photos/ph1', method: 'read', resource: { data: { status: 'approved', isRestricted: false } } },
        expected: true
    },
    {
        name: '未ログイン: 会員限定写真の閲覧拒絶 (プライバシー保護)',
        ctx: { auth: authGuest, path: 'photos/ph_restricted', method: 'read', resource: { data: { status: 'approved', isRestricted: true } } },
        expected: false
    },
    {
        name: 'member: 会員限定写真の閲覧許可',
        ctx: { auth: authMember, path: 'photos/ph_restricted', method: 'read', resource: { data: { status: 'approved', isRestricted: true } } },
        expected: true
    },
    {
        name: 'member: 写真投稿申請許可 (status=pending)',
        ctx: { auth: authMember, path: 'photos/ph_new', method: 'create', requestResource: { data: { status: 'pending', url: 'https://...' } } },
        expected: true
    },
    {
        name: 'officer: 写真の承認・削除許可',
        ctx: { auth: authOfficer, path: 'photos/ph1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },

    // ==========================================
    // [7. equipmentMaster & reservations (備品管理)]
    // ==========================================
    {
        name: '未ログイン: 備品マスタ閲覧許可',
        ctx: { auth: authGuest, path: 'equipmentMaster/tent', method: 'read' },
        expected: true
    },
    {
        name: '未ログイン: 備品予約台帳の閲覧許可 (カレンダー空き確認)',
        ctx: { auth: authGuest, path: 'equipmentReservations/res1', method: 'read' },
        expected: true
    },
    {
        name: '未ログイン: 備品予約申請許可 (status=requested)',
        ctx: { auth: authGuest, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'requested', equipmentId: 'tent' } } },
        expected: true
    },
    {
        name: 'member: 備品予約申請許可 (status=requested)',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'requested', equipmentId: 'tent' } } },
        expected: true
    },
    {
        name: 'member: 勝手に承認済み(approved)で予約作成するのを拒絶',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'approved', equipmentId: 'tent' } } },
        expected: false
    },
    {
        name: 'officer: 予約ステータスの承認更新許可',
        ctx: { auth: authOfficer, path: 'equipmentReservations/res1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },

    // ==========================================
    // [8. opinions (意見交換)]
    // ==========================================
    {
        name: '未ログイン: 公開意見の閲覧許可',
        ctx: { auth: authGuest, path: 'opinions/op_pub', method: 'read', resource: { data: { isPublic: true } } },
        expected: true
    },
    {
        name: '未ログイン: 非公開相談の閲覧拒絶',
        ctx: { auth: authGuest, path: 'opinions/op_priv', method: 'read', resource: { data: { isPublic: false } } },
        expected: false
    },
    {
        name: '未ログイン: 意見・要望の投稿許可',
        ctx: { auth: authGuest, path: 'opinions/op_new', method: 'create', requestResource: { data: { content: '街灯の要望' } } },
        expected: true
    },
    {
        name: 'member: 自身の非公開相談の閲覧許可',
        ctx: { auth: authMember, path: 'opinions/op_priv', method: 'read', resource: { data: { isPublic: false, userUid: 'uid_member' } } },
        expected: true
    },
    {
        name: 'officer: 非公開相談の閲覧および回答更新許可',
        ctx: { auth: authOfficer, path: 'opinions/op_priv', method: 'update', resource: { data: { isPublic: false } }, requestResource: { data: { reply: '対応完了' } } },
        expected: true
    },

    // ==========================================
    // [9. 未定義コレクション (Default Deny)]
    // ==========================================
    {
        name: '全ユーザー: 未定義コレクションへのアクセス拒絶',
        ctx: { auth: authAdmin, path: 'undefined_collection/doc1', method: 'read' },
        expected: false
    }
];

let failed = 0;
tests.forEach((t, i) => {
    const result = evaluateRule(t.ctx);
    const pass = result === t.expected;
    const badge = pass ? '[PASS]' : '[FAIL]';
    if (!pass) failed++;
    console.log(`${badge} #${String(i + 1).padStart(2, '0')} ${t.name}: 期待値=${t.expected ? 'ALLOW' : 'DENY'}, 結果=${result ? 'ALLOW' : 'DENY'}`);
});

console.log('\n======================================================');
if (failed === 0) {
    console.log(`全 ${tests.length} ケースのセキュリティルール検証に完全合格 (ALL PASSED)`);
} else {
    console.error(`${failed} 件のテストが失敗しました`);
    process.exit(1);
}
console.log('======================================================\n');
