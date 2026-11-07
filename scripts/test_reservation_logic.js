/**
 * 備品予約トランザクション・日別在庫計算ロジック単体テスト
 */

function formatDate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function inRange(target, start, end) {
    return target >= start && target <= end;
}

function getUsedQuantity(reservations, equipmentId, dateStr) {
    return reservations
        .filter((r) => r.equipmentId === equipmentId && inRange(dateStr, r.loanDate, r.returnDate))
        .filter((r) => ['requested', 'approved', 'borrowed'].includes(r.status))
        .reduce((sum, r) => sum + Number(r.quantity || 1), 0);
}

function checkReservationConflict(masterStock, existingReservations, newReservation) {
    const { equipmentId, quantity, loanDate, returnDate } = newReservation;
    let checkCurr = new Date(loanDate);
    const checkEnd = new Date(returnDate);

    while (checkCurr <= checkEnd) {
        const dStr = formatDate(checkCurr);
        const used = getUsedQuantity(existingReservations, equipmentId, dStr);
        if (used + quantity > masterStock) {
            const remain = Math.max(0, masterStock - used);
            return {
                ok: false,
                date: dStr,
                used,
                remain,
                message: `在庫不足 (${dStr}: 現在使用 ${used}台 / 総在庫 ${masterStock}台 / 残り ${remain}台)`
            };
        }
        checkCurr = addDays(checkCurr, 1);
    }
    return { ok: true };
}

// テストスイート実行
console.log('=== 備品予約排他・在庫計算テスト開始 ===');

const TOTAL_STOCK = 3; // テント総数3台
const reservations = [
    {
        id: 'res-1',
        equipmentId: 'tent',
        quantity: 2,
        loanDate: '2026-07-10',
        returnDate: '2026-07-12',
        status: 'approved'
    },
    {
        id: 'res-2',
        equipmentId: 'tent',
        quantity: 1,
        loanDate: '2026-07-05',
        returnDate: '2026-07-08',
        status: 'returned' // 返納済み
    }
];

// ケース1: 期間重複で在庫超過（7/11〜7/13に2台希望 → 7/11, 7/12で合計4台となりNG）
const test1 = checkReservationConflict(TOTAL_STOCK, reservations, {
    equipmentId: 'tent',
    quantity: 2,
    loanDate: '2026-07-11',
    returnDate: '2026-07-13'
});
console.log('Test 1 (期間重複・在庫超過の検出):', !test1.ok ? 'PASS' : 'FAIL', test1.message);
if (test1.ok) process.exit(1);

// ケース2: 期間重複だが在庫以内（7/11〜7/12に1台希望 → 合計3台でギリギリOK）
const test2 = checkReservationConflict(TOTAL_STOCK, reservations, {
    equipmentId: 'tent',
    quantity: 1,
    loanDate: '2026-07-11',
    returnDate: '2026-07-12'
});
console.log('Test 2 (期間重複・在庫以内の許可):', test2.ok ? 'PASS' : 'FAIL');
if (!test2.ok) process.exit(1);

// ケース3: 期間重複なし（7/13〜7/15に3台希望 → 前の予約は7/12返納なのでOK）
const test3 = checkReservationConflict(TOTAL_STOCK, reservations, {
    equipmentId: 'tent',
    quantity: 3,
    loanDate: '2026-07-13',
    returnDate: '2026-07-15'
});
console.log('Test 3 (期間重複なし・全在庫予約の許可):', test3.ok ? 'PASS' : 'FAIL');
if (!test3.ok) process.exit(1);

// ケース4: 返納完了済みレコードの在庫復元（7/05〜7/08に3台希望 → 返納済みなのでOK）
const test4 = checkReservationConflict(TOTAL_STOCK, reservations, {
    equipmentId: 'tent',
    quantity: 3,
    loanDate: '2026-07-06',
    returnDate: '2026-07-07'
});
console.log('Test 4 (返納済みデータの在庫復元確認):', test4.ok ? 'PASS' : 'FAIL');
if (!test4.ok) process.exit(1);

// ============================================================
// テスト5: 複数会員による同時並行予約競合シミュレーション (Transaction Simulation)
// ============================================================
class MockFirestoreDatabase {
    constructor(initialReservations, initialStock) {
        this.reservations = JSON.parse(JSON.stringify(initialReservations));
        this.stock = initialStock;
        this.version = 1; // 楽観的ロック用バージョン
    }

    // トランザクション実行 (runTransaction の挙動を再現)
    async runTransaction(updateFunction) {
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            attempts++;
            const currentVersion = this.version;
            const currentReservations = [...this.reservations];

            try {
                // トランザクション処理内での読み取り & 判定 & 書き込み計画
                const newRes = await updateFunction({
                    getReservations: () => currentReservations,
                    getStock: () => this.stock
                });

                // コミットフェーズ: 読み取り元バージョンが競合していないか検証
                if (this.version !== currentVersion) {
                    // 競合発生: リトライ
                    continue;
                }

                // コミット成功
                this.reservations.push(newRes);
                this.version++;
                return { success: true, reservation: newRes, attempts };
            } catch (err) {
                // ビジネスロジックエラー（在庫不足など）は即時スロー
                throw err;
            }
        }
        throw new Error('トランザクション競合上限を超過しました');
    }
}

async function runConcurrencyTest() {
    const db = new MockFirestoreDatabase(reservations, TOTAL_STOCK);
    // 7/11 に残り 1 台の在庫がある状態
    // User A と User B が同時に 1 台を予約しようとする
    const userAPromise = db.runTransaction(async (t) => {
        const curRes = t.getReservations();
        const check = checkReservationConflict(t.getStock(), curRes, {
            equipmentId: 'tent',
            quantity: 1,
            loanDate: '2026-07-11',
            returnDate: '2026-07-11'
        });
        if (!check.ok) throw new Error(check.message);
        return {
            id: 'res-userA',
            equipmentId: 'tent',
            quantity: 1,
            loanDate: '2026-07-11',
            returnDate: '2026-07-11',
            status: 'requested',
            user: 'userA'
        };
    });

    const userBPromise = db.runTransaction(async (t) => {
        const curRes = t.getReservations();
        const check = checkReservationConflict(t.getStock(), curRes, {
            equipmentId: 'tent',
            quantity: 1,
            loanDate: '2026-07-11',
            returnDate: '2026-07-11'
        });
        if (!check.ok) throw new Error(check.message);
        return {
            id: 'res-userB',
            equipmentId: 'tent',
            quantity: 1,
            loanDate: '2026-07-11',
            returnDate: '2026-07-11',
            status: 'requested',
            user: 'userB'
        };
    });

    const results = await Promise.allSettled([userAPromise, userBPromise]);
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // 1台しか余っていないため、片方のみ成功し片方は在庫不足で拒否されるべき
    const isConcurrencySafe = (succeeded.length === 1 && rejected.length === 1);
    console.log('Test 5 (同時予約トランザクション競合排他制御):', isConcurrencySafe ? 'PASS' : 'FAIL',
        `成功: ${succeeded.length}件 / 拒否: ${rejected.length}件`);
    if (!isConcurrencySafe) process.exit(1);
}

// ============================================================
// テスト6: 予約ライフサイクルの状態遷移バリデーション
// ============================================================
const VALID_TRANSITIONS = {
    'requested': ['approved', 'cancelled'],
    'approved': ['borrowed', 'cancelled'],
    'borrowed': ['returned'],
    'returned': [],
    'cancelled': []
};

function canTransition(currentStatus, nextStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(nextStatus);
}

const t6_1 = canTransition('requested', 'approved'); // OK
const t6_2 = canTransition('approved', 'borrowed');  // OK
const t6_3 = canTransition('borrowed', 'returned');  // OK
const t6_4 = canTransition('returned', 'borrowed');  // 不正 (返納後の再貸出は新規予約が必要)
const t6_5 = canTransition('cancelled', 'approved'); // 不正 (取消後の復活不可)

const stateTestOk = (t6_1 && t6_2 && t6_3 && !t6_4 && !t6_5);
console.log('Test 6 (予約ライフサイクル状態遷移判定):', stateTestOk ? 'PASS' : 'FAIL');
if (!stateTestOk) process.exit(1);

// ============================================================
// テスト7: 権限別アクセス制御 (Security Rules ロジック検証)
// ============================================================
function evaluateSecurityRule(action, role, resourceOwnerUid, authUid) {
    if (action === 'updateMasterStock') {
        // マスタ在庫変更は役員のみ
        return role === 'officer';
    }
    if (action === 'approveReservation') {
        // 予約承認は役員のみ
        return role === 'officer';
    }
    if (action === 'cancelReservation') {
        // 予約取消は役員または予約本人
        return role === 'officer' || (authUid && authUid === resourceOwnerUid);
    }
    return false;
}

const t7_1 = evaluateSecurityRule('updateMasterStock', 'member', 'userA', 'userA'); // 一般会員が在庫改ざん -> 拒否
const t7_2 = evaluateSecurityRule('updateMasterStock', 'officer', 'officer1', 'officer1'); // 役員が在庫変更 -> 許可
const t7_3 = evaluateSecurityRule('approveReservation', 'member', 'userA', 'userA'); // 本人が勝手に自己承認 -> 拒否
const t7_4 = evaluateSecurityRule('cancelReservation', 'member', 'userA', 'userA'); // 本人が自分の予約を取り消し -> 許可
const t7_5 = evaluateSecurityRule('cancelReservation', 'member', 'userA', 'userB'); // 他人が勝手に予約を取り消し -> 拒否

const securityTestOk = (!t7_1 && t7_2 && !t7_3 && t7_4 && !t7_5);
console.log('Test 7 (Security Rules 権限分離・改ざん防止):', securityTestOk ? 'PASS' : 'FAIL');
if (!securityTestOk) process.exit(1);

runConcurrencyTest().then(() => {
    console.log('=== 全ての備品予約・トランザクション・権限テストに合格 (ALL PASSED) ===');
}).catch((err) => {
    console.error('トランザクションテスト失敗:', err);
    process.exit(1);
});
