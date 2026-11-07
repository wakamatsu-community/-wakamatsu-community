// scripts/test_security_rules.js
/**
 * Firestore Security Rules アクセス制御マトリクス自動検証テスト
 *
 * 検証対象:
 *   1. 未ログイン (ゲスト住民)
 *   2. 共通会員 (町内会合言葉認証)
 *   3. 役員 (officer)
 *   4. システム管理者 (admin)
 */

console.log('=== Firestore Security Rules アクセス制御検証テスト開始 ===\n');

// Security Rules ロジックのエミュレータ関数
function evaluateRule(ruleContext) {
    const { auth, resource, requestResource, path, method } = ruleContext;

    const isAuthenticated = auth !== null;
    const isCommonMember = isAuthenticated && Boolean(auth.email && auth.email.includes('member@'));
    const isIndividualMember = isAuthenticated && !isCommonMember;

    const userRole = auth?.role || (isCommonMember ? 'member' : 'guest');
    const isOfficer = isAuthenticated && (userRole === 'officer' || userRole === 'admin');
    const isAdmin = isAuthenticated && userRole === 'admin';
    const isOwner = (uid) => isAuthenticated && auth.uid === uid;

    // 1. events
    if (path.startsWith('events/')) {
        if (method === 'read') {
            if (resource?.data?.status === 'published' && resource?.data?.isRestricted !== true) return true;
            return isAuthenticated;
        }
        if (method === 'write') {
            return isOfficer;
        }
    }

    // 2. communityEvents
    if (path.startsWith('communityEvents/')) {
        if (path.includes('/entries/')) {
            // entries
            if (method === 'read') {
                if (isOfficer) return true;
                if (isIndividualMember && isOwner(resource?.data?.uid)) return true;
                return false;
            }
            if (method === 'create') {
                return isIndividualMember && isOwner(requestResource?.data?.uid);
            }
        }
        if (method === 'read') {
            if (resource?.data?.status === 'approved' && resource?.data?.isRestricted !== true) return true;
            if (isOfficer) return true;
            if (isIndividualMember && resource?.data?.organizerUid === auth?.uid) return true;
            return false;
        }
        if (method === 'create') {
            return isIndividualMember && requestResource?.data?.status === 'pending';
        }
        if (method === 'update') {
            return isOfficer || (isIndividualMember && resource?.data?.organizerUid === auth?.uid && resource?.data?.status === 'pending');
        }
        if (method === 'delete') {
            return isOfficer;
        }
    }

    // 3. eventPlanning
    if (path.startsWith('eventPlanning/')) {
        return isOfficer;
    }

    // 4. documents
    if (path.startsWith('documents/')) {
        if (method === 'read') {
            if (resource?.data?.isRestricted !== true) return true;
            return isAuthenticated;
        }
        if (method === 'write') return isOfficer;
    }

    // 5. equipmentReservations
    if (path.startsWith('equipmentReservations/')) {
        if (method === 'read') return true;
        if (method === 'create') {
            return isIndividualMember && requestResource?.data?.userUid === auth?.uid;
        }
        if (method === 'update') {
            return isOfficer || (isIndividualMember && isOwner(resource?.data?.userUid) && resource?.data?.status === 'requested');
        }
        if (method === 'delete') return isOfficer;
    }

    // 6. users
    if (path.startsWith('users/')) {
        const targetUserId = path.split('/')[1];
        if (method === 'read') return isAuthenticated;
        if (method === 'create') return isOwner(targetUserId) && requestResource?.data?.role === 'member';
        if (method === 'update') {
            if (isAdmin) return true;
            // 本人であっても role の書き換えは絶対に拒絶
            if (isOwner(targetUserId) && requestResource?.data?.role === resource?.data?.role) return true;
            return false;
        }
        if (method === 'delete') return isAdmin;
    }

    // 7. 未定義コレクション
    return false;
}

const tests = [
    // [未ログイン]
    {
        name: '未ログイン: 公開公式行事の閲覧',
        ctx: { auth: null, path: 'events/ev1', method: 'read', resource: { data: { status: 'published', isRestricted: false } } },
        expected: true
    },
    {
        name: '未ログイン: 会員限定行事の閲覧拒絶',
        ctx: { auth: null, path: 'events/ev2', method: 'read', resource: { data: { status: 'published', isRestricted: true } } },
        expected: false
    },
    {
        name: '未ログイン: 公式行事の新規追加拒絶',
        ctx: { auth: null, path: 'events/ev3', method: 'write', requestResource: { data: { title: '勝手に追加' } } },
        expected: false
    },
    {
        name: '未ログイン: 会員限定資料(総会資料)の閲覧拒絶',
        ctx: { auth: null, path: 'documents/doc1', method: 'read', resource: { data: { isRestricted: true } } },
        expected: false
    },

    // [共通合言葉会員]
    {
        name: '共通会員: 会員限定行事の閲覧許可',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'events/ev2', method: 'read', resource: { data: { status: 'published', isRestricted: true } } },
        expected: true
    },
    {
        name: '共通会員: 会員限定資料の閲覧許可',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'documents/doc1', method: 'read', resource: { data: { isRestricted: true } } },
        expected: true
    },
    {
        name: '共通会員: 公式行事の作成・変更拒絶 (閲覧専用保護)',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'events/ev1', method: 'write', requestResource: { data: { title: '改変' } } },
        expected: false
    },
    {
        name: '共通会員: 参加者台帳(entries)への共通UID書き込み拒絶 (個人情報混入防止)',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'communityEvents/c1/entries/e1', method: 'create', requestResource: { data: { uid: 'common_uid' } } },
        expected: false
    },
    {
        name: '共通会員: 備品予約への共通UID書き込み拒絶 (予約重複防止)',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'equipmentReservations/res1', method: 'create', requestResource: { data: { userUid: 'common_uid' } } },
        expected: false
    },
    {
        name: '共通会員: 役員ロールへの自己昇格拒絶 (role改ざん遮断)',
        ctx: { auth: { uid: 'common_uid', email: 'member@wakamatsu-cho.internal', role: 'member' }, path: 'users/common_uid', method: 'update', resource: { data: { role: 'member' } }, requestResource: { data: { role: 'officer' } } },
        expected: false
    },

    // [役員 (officer)]
    {
        name: '役員: 公式行事の追加・更新許可',
        ctx: { auth: { uid: 'officer_01', email: 'officer@wakamatsu-cho.internal', role: 'officer' }, path: 'events/ev1', method: 'write', requestResource: { data: { title: '清掃' } } },
        expected: true
    },
    {
        name: '役員: 既存企画アーカイブ(eventPlanning)の参照許可',
        ctx: { auth: { uid: 'officer_01', email: 'officer@wakamatsu-cho.internal', role: 'officer' }, path: 'eventPlanning/p1', method: 'read' },
        expected: true
    },
    {
        name: '役員: 自身のロールを管理者(admin)へ自己昇格するのを拒絶',
        ctx: { auth: { uid: 'officer_01', email: 'officer@wakamatsu-cho.internal', role: 'officer' }, path: 'users/officer_01', method: 'update', resource: { data: { role: 'officer' } }, requestResource: { data: { role: 'admin' } } },
        expected: false
    },

    // [システム管理者 (admin)]
    {
        name: 'システム管理者: 会員ロールの変更許可 (初期付与・昇格)',
        ctx: { auth: { uid: 'admin_niina', email: 'niina@wakamatsu-cho.internal', role: 'admin' }, path: 'users/user_target', method: 'update', resource: { data: { role: 'member' } }, requestResource: { data: { role: 'officer' } } },
        expected: true
    },
    {
        name: '未定義コレクションへのアクセス拒絶 (デフォルト拒絶)',
        ctx: { auth: { uid: 'admin_niina', email: 'niina@wakamatsu-cho.internal', role: 'admin' }, path: 'unknownCollection/doc1', method: 'read' },
        expected: false
    }
];

let failed = 0;
tests.forEach((t, i) => {
    const result = evaluateRule(t.ctx);
    const pass = result === t.expected;
    const badge = pass ? '[PASS]' : '[FAIL]';
    if (!pass) failed++;
    console.log(`${badge} #${i + 1} ${t.name}: 期待値=${t.expected ? 'ALLOW' : 'DENY'}, 結果=${result ? 'ALLOW' : 'DENY'}`);
});

console.log('\n======================================================');
if (failed === 0) {
    console.log(`全 ${tests.length} ケースのセキュリティルール検証に完全合格 (ALL PASSED)`);
} else {
    console.error(`${failed} 件のテストが失敗しました`);
    process.exit(1);
}
console.log('======================================================\n');
