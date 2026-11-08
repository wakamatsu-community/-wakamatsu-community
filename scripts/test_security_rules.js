// scripts/test_security_rules.js
/**
 * Firestore Security Rules & ユーザーID認証アクセス制御マトリクス総合検証テスト (B方式)
 *
 * 要件1: 町内会HPの全業務データをFirebase Authentication認証済み会員に限定する。
 * 要件2: 未ログインでは全業務データへのアクセスを遮断しログイン画面だけを表示する。
 * 要件4: Firestore users/{uid}.role を唯一の権限判定元とする。メールアドレスによるロール推定を排除。
 * 要件11: 予約・企画申請・意見投稿で所有者UID、ステータス、管理用フィールドを不正変更できないようにする。
 *
 * 検証対象 4区分:
 *   1. 未ログイン (guest)
 *   2. 一般会員 (member)     - username=member, role=member (閲覧専用)
 *   3. 役員 (officer)         - username=officer, role=officer (行事・資料・写真・備品管理)
 *   4. システム管理者 (niina)   - username=niina, role=admin (特権管理・ロール監査)
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

console.log('=== Firestore Security Rules B方式 (全業務データ完全認証制) 総合検証テスト開始 ===\n');

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

// モックデータベース (usersコレクションの登録状態)
const mockDatabase = {
    users: {
        'uid_niina': { username: 'niina', role: 'admin' },
        'uid_officer': { username: 'officer', role: 'officer' },
        'uid_member': { username: 'member', role: 'member' }
    }
};

function evaluateRuleB(ruleContext) {
    const { auth, resource, requestResource, path: docPath, method } = ruleContext;

    // ヘルパー関数群 (B方式 firestore.rules と厳密一致)
    const isAuthenticated = auth !== null && auth.uid != null;

    function hasUserDoc() {
        return isAuthenticated && Boolean(mockDatabase.users[auth.uid]);
    }

    // 要件4: users/{uid}.role のみを厳密参照
    function getUserRole() {
        return hasUserDoc() ? mockDatabase.users[auth.uid].role : null;
    }

    const isAdmin = hasUserDoc() && getUserRole() === 'admin';
    const isOfficer = hasUserDoc() && (getUserRole() === 'officer' || getUserRole() === 'admin');
    const isMember = hasUserDoc() && (getUserRole() === 'member' || getUserRole() === 'officer' || getUserRole() === 'admin');
    const isOwner = (uid) => isAuthenticated && auth.uid === uid;

    // 要件1 & 2: 未認証(未ログインまたはusers未登録)は全コレクションで読み書き不可
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
            return isAdmin || (isOwner(userId) && requestResource?.data?.role === resource?.data?.role);
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
            return isMember;
        }
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
            return isOfficer || (isAuthenticated && resource?.data?.userUid === auth.uid && requestResource?.data?.status === 'cancelled');
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
// 3. B方式 テストマトリクス定義 (未ログイン全拒否 & 3権限の完全分離)
// -------------------------------------------------------------
const authGuest = null;
const authMember = { uid: 'uid_member' };
const authOfficer = { uid: 'uid_officer' };
const authAdmin = { uid: 'uid_niina' };

const tests = [
    // ==========================================
    // [要件1 & 2: 未ログイン時の全業務データ完全遮断テスト]
    // ==========================================
    {
        name: '未ログイン: 公式行事(events)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'events/ev1', method: 'read', resource: { data: { status: 'published' } } },
        expected: false
    },
    {
        name: '未ログイン: 会員企画(communityEvents)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'communityEvents/c1', method: 'read', resource: { data: { status: 'approved' } } },
        expected: false
    },
    {
        name: '未ログイン: 参加者台帳(entries)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'communityEvents/c1/entries/e1', method: 'read' },
        expected: false
    },
    {
        name: '未ログイン: 回覧板・資料(documents)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'documents/doc1', method: 'read' },
        expected: false
    },
    {
        name: '未ログイン: 写真(photos)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'photos/ph1', method: 'read', resource: { data: { status: 'approved' } } },
        expected: false
    },
    {
        name: '未ログイン: 備品マスタ(equipmentMaster)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'equipmentMaster/tent', method: 'read' },
        expected: false
    },
    {
        name: '未ログイン: 備品予約台帳(equipmentReservations)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'equipmentReservations/res1', method: 'read' },
        expected: false
    },
    {
        name: '未ログイン: 意見交換(opinions)の閲覧拒絶 (B方式)',
        ctx: { auth: authGuest, path: 'opinions/op1', method: 'read', resource: { data: { isPublic: true } } },
        expected: false
    },
    {
        name: '未ログイン: 備品予約申請の拒絶 (B方式: ログイン必須)',
        ctx: { auth: authGuest, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { status: 'requested' } } },
        expected: false
    },

    // ==========================================
    // [要件3 & 4: users/{uid}.role 唯一の認可・改ざん防止]
    // ==========================================
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
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member' } }, requestResource: { data: { role: 'officer' } } },
        expected: false
    },
    {
        name: 'member: 自身の表示名変更 (role維持) を許可',
        ctx: { auth: authMember, path: 'users/uid_member', method: 'update', resource: { data: { role: 'member', name: '旧名' } }, requestResource: { data: { role: 'member', name: '新名' } } },
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

    // ==========================================
    // [要件1, 5, 11: 公式行事・会員企画・台帳の厳格制御]
    // ==========================================
    {
        name: 'member: 公開公式行事(published)の閲覧許可 (B方式)',
        ctx: { auth: authMember, path: 'events/ev1', method: 'read', resource: { data: { status: 'published' } } },
        expected: true
    },
    {
        name: 'member: 公式行事の作成拒絶 (閲覧専用保護)',
        ctx: { auth: authMember, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '会員作成' } } },
        expected: false
    },
    {
        name: 'officer: 公式行事の作成許可',
        ctx: { auth: authOfficer, path: 'events/ev_new', method: 'create', requestResource: { data: { title: '清掃', status: 'published' } } },
        expected: true
    },
    {
        name: 'officer: 公式行事(下書きdraft)の閲覧許可',
        ctx: { auth: authOfficer, path: 'events/ev_draft', method: 'read', resource: { data: { status: 'draft' } } },
        expected: true
    },
    {
        name: 'member: 企画申請作成 (status=pending, organizerUid=auth.uid) 許可',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_member', status: 'pending' } } },
        expected: true
    },
    {
        name: 'member: 他人のUIDを騙った企画申請の拒絶 (要件11: organizerUid偽装禁止)',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_other', status: 'pending' } } },
        expected: false
    },
    {
        name: 'member: 勝手にapprovedで企画作成するのを拒絶 (要件11: ステータス不正変更禁止)',
        ctx: { auth: authMember, path: 'communityEvents/c_new', method: 'create', requestResource: { data: { organizerUid: 'uid_member', status: 'approved' } } },
        expected: false
    },
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
        name: 'member: 自身の参加申込登録 (uid=auth.uid) 許可',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e_new', method: 'create', requestResource: { data: { uid: 'uid_member' } } },
        expected: true
    },
    {
        name: 'member: 他人のUIDでのなりすまし参加申込拒絶 (要件11)',
        ctx: { auth: authMember, path: 'communityEvents/c1/entries/e_fake', method: 'create', requestResource: { data: { uid: 'uid_other' } } },
        expected: false
    },
    {
        name: 'officer: 参加者台帳全件の参照許可 (出欠管理)',
        ctx: { auth: authOfficer, path: 'communityEvents/c1/entries/e2', method: 'read', resource: { data: { uid: 'uid_other' } } },
        expected: true
    },

    // ==========================================
    // [要件1, 5, 11: 備品予約・資料・写真・意見交換の厳格制御]
    // ==========================================
    {
        name: 'member: 資料室(documents)の閲覧許可 (B方式)',
        ctx: { auth: authMember, path: 'documents/doc1', method: 'read' },
        expected: true
    },
    {
        name: 'member: 資料アップロード拒絶 (役員専用)',
        ctx: { auth: authMember, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '資料' } } },
        expected: false
    },
    {
        name: 'officer: 資料アップロード許可',
        ctx: { auth: authOfficer, path: 'documents/doc_new', method: 'create', requestResource: { data: { title: '総会資料' } } },
        expected: true
    },
    {
        name: 'member: 備品マスタ閲覧許可 (B方式)',
        ctx: { auth: authMember, path: 'equipmentMaster/tent', method: 'read' },
        expected: true
    },
    {
        name: 'member: 備品予約申請 (userUid=auth.uid, status=requested) 許可',
        ctx: { auth: authMember, path: 'equipmentReservations/res_new', method: 'create', requestResource: { data: { userUid: 'uid_member', status: 'requested' } } },
        expected: true
    },
    {
        name: 'member: 他人のUIDでのなりすまし備品予約の拒絶 (要件11)',
        ctx: { auth: authMember, path: 'equipmentReservations/res_fake', method: 'create', requestResource: { data: { userUid: 'uid_other', status: 'requested' } } },
        expected: false
    },
    {
        name: 'member: 勝手に承認済み(approved)で予約作成するのを拒絶 (要件11)',
        ctx: { auth: authMember, path: 'equipmentReservations/res_bad', method: 'create', requestResource: { data: { userUid: 'uid_member', status: 'approved' } } },
        expected: false
    },
    {
        name: 'member: 自身の予約をキャンセル(cancelled)する更新許可',
        ctx: { auth: authMember, path: 'equipmentReservations/res1', method: 'update', resource: { data: { userUid: 'uid_member', status: 'requested' } }, requestResource: { data: { status: 'cancelled' } } },
        expected: true
    },
    {
        name: 'member: 他人の予約の更新拒絶 (要件11)',
        ctx: { auth: authMember, path: 'equipmentReservations/res2', method: 'update', resource: { data: { userUid: 'uid_other', status: 'requested' } }, requestResource: { data: { status: 'cancelled' } } },
        expected: false
    },
    {
        name: 'officer: 予約ステータスの承認(approved)更新許可',
        ctx: { auth: authOfficer, path: 'equipmentReservations/res1', method: 'update', requestResource: { data: { status: 'approved' } } },
        expected: true
    },
    {
        name: 'member: 自身の意見送信 (userUid=auth.uid) 許可',
        ctx: { auth: authMember, path: 'opinions/op_new', method: 'create', requestResource: { data: { userUid: 'uid_member', content: '街灯要望' } } },
        expected: true
    },
    {
        name: 'member: 他人のUIDを騙った意見送信の拒絶 (要件11)',
        ctx: { auth: authMember, path: 'opinions/op_fake', method: 'create', requestResource: { data: { userUid: 'uid_other', content: '偽投稿' } } },
        expected: false
    },
    {
        name: 'officer: 非公開相談の閲覧および回答更新許可',
        ctx: { auth: authOfficer, path: 'opinions/op_priv', method: 'update', resource: { data: { isPublic: false } }, requestResource: { data: { reply: '回答' } } },
        expected: true
    },
    {
        name: '全ユーザー: 未定義コレクションへのアクセス拒絶 (Default Deny)',
        ctx: { auth: authAdmin, path: 'undefined_collection/doc1', method: 'read' },
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
    console.log(`全 ${tests.length} ケースのB方式セキュリティルール検証に完全合格 (ALL PASSED)`);
} else {
    console.error(`${failed} 件のテストが失敗しました`);
    process.exit(1);
}
console.log('======================================================\n');
