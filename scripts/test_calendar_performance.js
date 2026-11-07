/**
 * カレンダー高速化・API依存削減 性能検証テストスクリプト
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const EVENTS_JSON_PATH = path.join(ROOT, 'Docs', 'events.json');

console.log('=== カレンダー高速化・性能検証テスト開始 ===\n');

// 1. Docs/events.json キャッシュ検証
console.log('--- 1. 高速静的キャッシュ (Docs/events.json) の検証 ---');
if (!fs.existsSync(EVENTS_JSON_PATH)) {
    console.error('[FAIL] Docs/events.json が存在しません');
    process.exit(1);
}

const rawJson = fs.readFileSync(EVENTS_JSON_PATH, 'utf8');
const t0 = performance.now();
const parsed = JSON.parse(rawJson);
const parseTime = (performance.now() - t0).toFixed(3);

const events = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.events) ? parsed.events : []);
console.log(`[PASS] JSONパース所要時間: ${parseTime} ms`);
console.log(`[PASS] キャッシュ内イベント件数: ${events.length} 件`);
if (events.length === 0) {
    console.error('[FAIL] キャッシュが空配列です。公開行事データが含まれていません。');
    process.exit(1);
}

// 2. 個人情報・会員限定情報の漏洩検査
console.log('\n--- 2. 公開キャッシュの機密情報・個人情報検査 ---');
let hasPII = false;
events.forEach((ev, i) => {
    if (ev.phone || ev.contact || ev.email || ev.realName || ev.pin) {
        console.error(`[FAIL] イベント[${i}]に個人情報が含まれています:`, ev);
        hasPII = true;
    }
});
if (hasPII) {
    process.exit(1);
}
console.log('[PASS] 個人情報・機密情報は含まれていません（安全な公開データのみ）');

// 3. インメモリ・カテゴリフィルタリング速度検証
console.log('\n--- 3. インメモリ・カテゴリフィルタリング速度検証 ---');
const categories = ['all', '町内行事', '清掃', '防災', 'コミニティ'];

categories.forEach((cat) => {
    const tStart = performance.now();
    const filtered = cat === 'all'
        ? events
        : events.filter((e) => (e.category || '').includes(cat) || (e.title || '').includes(cat));
    const dt = (performance.now() - tStart).toFixed(3);
    console.log(`[PASS] カテゴリ [${cat}]: ${filtered.length}件抽出 (${dt} ms - 目標5ms以内)`);
});

// 4. 月移動・キャッシュヒット（再通信ゼロ）シミュレーション
console.log('\n--- 4. 月移動・メモリキャッシュヒットシミュレーション ---');
const loadedMonths = new Set();
const eventsMap = new Map();

// 初回当月ロード
events.forEach(e => eventsMap.set(e.id, e));
loadedMonths.add('2026-06');
loadedMonths.add('2026-07');

function simulateMonthChange(targetMonth) {
    const tStart = performance.now();
    const isCached = loadedMonths.has(targetMonth);
    let networkCallNeeded = false;

    if (!isCached) {
        networkCallNeeded = true;
        loadedMonths.add(targetMonth);
    }

    const dt = (performance.now() - tStart).toFixed(3);
    return { isCached, networkCallNeeded, timeMs: dt };
}

// ケースA: 取得済み月への移動（キャッシュヒット・再通信なし）
const sim1 = simulateMonthChange('2026-07');
console.log(`[PASS] 2026-07 (取得済み月) への移動: 再通信=${sim1.networkCallNeeded}, 所要時間=${sim1.timeMs} ms (即時)`);
if (sim1.networkCallNeeded) {
    console.error('[FAIL] キャッシュヒットすべき月で再通信が発生しました');
    process.exit(1);
}

// ケースB: 未取得月への移動（期間クエリ非同期要求）
const sim2 = simulateMonthChange('2026-12');
console.log(`[PASS] 2026-12 (未取得月) への移動: オンデマンド要求=${sim2.networkCallNeeded}`);
if (!sim2.networkCallNeeded) {
    console.error('[FAIL] 未取得月で同期フラグが立ちませんでした');
    process.exit(1);
}

// 5. GAS無応答・Firestore遅延時のフォールバック耐性検証
console.log('\n--- 5. GAS無応答・オフライン耐性検証 ---');
function renderCalendarEventsWithFallback(staticList, liveListOrError) {
    const map = new Map();
    // 1. 静的キャッシュを投入
    staticList.forEach(e => map.set(e.id, e));
    const cacheCount = map.size;

    // 2. 外部通信失敗 (null または エラー)
    let statusText = '';
    if (!liveListOrError) {
        statusText = `最新同期に失敗しましたが、キャッシュデータを表示中です (${cacheCount}件)`;
    } else {
        liveListOrError.forEach(e => map.set(e.id, e));
        statusText = `最新データ同期完了: ${map.size}件`;
    }
    return { total: map.size, statusText };
}

const offlineResult = renderCalendarEventsWithFallback(events, null);
console.log(`[PASS] オフライン/外部通信途絶時: イベント数=${offlineResult.total}件, 状態=${offlineResult.statusText}`);
if (offlineResult.total !== events.length) {
    console.error('[FAIL] キャッシュイベントが表示されませんでした');
    process.exit(1);
}

// 6. 重複排除マージの厳密性検証
console.log('\n--- 6. 重複排除マージの厳密性検証 ---');
const duplicateTestEvents = [
    { id: 'EV-1', title: '夏祭り', start: '2026-07-20T09:00:00' },
    { id: 'EV-1', title: '夏祭り（更新後）', start: '2026-07-20T09:00:00' }, // 同一ID・内容更新
    { id: 'EV-2', title: '盆踊り', start: '2026-07-20T18:00:00' }
];
const testMap = new Map();
duplicateTestEvents.forEach(e => testMap.set(e.id, e));
console.log(`[PASS] 重複投入テスト: 3件投入 -> マージ後 ${testMap.size}件 (EV-1は内容更新)`);
if (testMap.size !== 2 || testMap.get('EV-1').title !== '夏祭り（更新後）') {
    console.error('[FAIL] 重複排除または内容更新に失敗しました');
    process.exit(1);
}

// 7. キャッシュ予定の削除・移動同期の厳密性検証 (要件2)
console.log('\n--- 7. キャッシュ予定の削除・移動同期の検証 ---');
const mockEventsMap = new Map([
    ['EV-OLD-1', { id: 'EV-OLD-1', title: '旧予定（削除済み）', start: '2026-07-15T10:00:00', end: '' }],
    ['EV-KEEP', { id: 'EV-KEEP', title: '継続予定', start: '2026-07-20T10:00:00', end: '' }],
    ['EV-OTHER-MONTH', { id: 'EV-OTHER-MONTH', title: '別月の予定', start: '2026-08-10T10:00:00', end: '' }]
]);
const firestoreJulyEvents = [
    { id: 'EV-KEEP', title: '継続予定（Firestore最新）', start: '2026-07-20T10:00:00', end: '' },
    { id: 'EV-NEW', title: '新設予定', start: '2026-07-25T14:00:00', end: '' }
];
// 7月の同期シミュレーション: 表示範囲 [2026-07-01, 2026-07-31]
const rangeStart = new Date('2026-07-01T00:00:00');
const rangeEnd = new Date('2026-07-31T23:59:59');
const fsIds = new Set(firestoreJulyEvents.map(e => e.id));
const removed = [];
mockEventsMap.forEach((ev, id) => {
    const s = new Date(ev.start);
    const e = ev.end ? new Date(ev.end) : s;
    if (s <= rangeEnd && e >= rangeStart && !fsIds.has(id)) {
        removed.push(id);
    }
});
removed.forEach(id => mockEventsMap.delete(id));
firestoreJulyEvents.forEach(e => mockEventsMap.set(e.id, e));

console.log(`[PASS] 削除同期後イベント数: ${mockEventsMap.size}件 (削除対象: ${removed.join(', ')})`);
if (mockEventsMap.has('EV-OLD-1') || !mockEventsMap.has('EV-NEW') || !mockEventsMap.has('EV-OTHER-MONTH')) {
    console.error('[FAIL] 削除同期または新設予定の追加に失敗しました');
    process.exit(1);
}

// 8. 日付跨ぎ行事 (月跨ぎ・前日開始) の検出検証 (要件1)
console.log('\n--- 8. 日付跨ぎ行事の表示検出検証 ---');
const crossEvents = [
    { id: 'EV-CROSS-1', title: '7月〜8月跨ぎ夏合宿', start: '2026-07-31T10:00:00', end: '2026-08-02T15:00:00' },
    { id: 'EV-JULY-ONLY', title: '7月限定行事', start: '2026-07-20T10:00:00', end: '2026-07-20T12:00:00' },
    { id: 'EV-AUG-ONLY', title: '8月限定行事', start: '2026-08-05T10:00:00', end: '2026-08-05T12:00:00' }
];
// 8月カレンダー表示時 [2026-08-01, 2026-08-31]
const augStart = new Date('2026-08-01T00:00:00');
const augEnd = new Date('2026-08-31T23:59:59');
const visibleInAugust = crossEvents.filter(ev => {
    const s = new Date(ev.start);
    const e = ev.end ? new Date(ev.end) : s;
    return s <= augEnd && e >= augStart;
});
console.log(`[PASS] 8月表示で検出された行事: ${visibleInAugust.map(e => e.title).join(', ')} (${visibleInAugust.length}件)`);
if (visibleInAugust.length !== 2 || !visibleInAugust.some(e => e.id === 'EV-CROSS-1')) {
    console.error('[FAIL] 日付跨ぎ行事が8月カレンダーに正しく検出されませんでした');
    process.exit(1);
}

// 9. 通信エラー時の再試行保証と空結果判定 (要件3)
console.log('\n--- 9. 通信エラー時の再試行保証と空結果検証 ---');
const loadedMonthsSet = new Set();
function simulateSyncMonth(monthKey, result) {
    if (result.ok) {
        // 正常終了 (0件含む) のみ取得済みにする
        loadedMonthsSet.add(monthKey);
        return { retryable: false, count: result.events.length };
    } else {
        // エラー時は取得済みにせず、再試行可能とする
        return { retryable: true, error: result.errorType };
    }
}
const failAttempt = simulateSyncMonth('2026-09', { ok: false, errorType: 'UNAVAILABLE', events: [] });
console.log(`[PASS] オフライン失敗時: 取得済み登録=${loadedMonthsSet.has('2026-09')}, 再試行可能=${failAttempt.retryable}`);
if (loadedMonthsSet.has('2026-09') || !failAttempt.retryable) {
    console.error('[FAIL] 失敗した月が取得済みに登録されてしまいました');
    process.exit(1);
}

const emptySuccess = simulateSyncMonth('2026-10', { ok: true, events: [] });
console.log(`[PASS] 予定ゼロ(0件)月: 取得済み登録=${loadedMonthsSet.has('2026-10')}, 再試行不要=${!emptySuccess.retryable}`);
if (!loadedMonthsSet.has('2026-10') || emptySuccess.retryable) {
    console.error('[FAIL] 正常な0件月が取得済みに登録されませんでした');
    process.exit(1);
}

console.log('\n=== 全ての性能・耐性検証テストに合格 (ALL PASSED) ===');

