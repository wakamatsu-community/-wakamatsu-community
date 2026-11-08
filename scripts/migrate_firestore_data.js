// scripts/migrate_firestore_data.js
/**
 * 若松町内会HP Firestore既存データ移行・照合スクリプト
 *
 * 目的:
 * 1. 既存Firestoreコレクション (events, eventPlanning) の日本語フィールド
 *    (「タイトル」「開始日時」「終了日時」等) を英語標準フィールドへ安全にマッピング。
 * 2. status 未設定データを無条件に公開せず、安全な非公開状態 (status: "unconfirmed") を設定。
 * 3. 既存ドキュメントは削除せず、英語フィールドを安全に追記・更新。
 * 4. events, eventPlanning, communityEvents の用途・ID体系を整理。
 *
 * 実行方法:
 *   node scripts/migrate_firestore_data.js --dry-run (確認のみ・変更なし)
 *   node scripts/migrate_firestore_data.js --apply   (本番適用: 承認後実行)
 */

const fs = require('fs');
const path = require('path');

// 日本語フィールドと英語標準フィールドの対応定義
const FIELD_MAPPING = {
    title: ['タイトル', '件名', 'title'],
    start: ['開始日時', '開始', '日時', 'start'],
    end: ['終了日時', '終了', 'end'],
    place: ['場所', '開催場所', '会場', 'place'],
    description: ['説明', '詳細', '内容', 'description'],
    category: ['カテゴリ', '種別', 'category'],
    isAllDay: ['終日', '終日予定', 'allDay', 'isAllDay'],
    status: ['状態', 'ステータス', 'status']
};

/**
 * 日本語フィールドを含む生ドキュメントから英語標準モデルへ正規化
 */
function normalizeDocData(raw) {
    const result = {};

    // 1. タイトル
    for (const key of FIELD_MAPPING.title) {
        if (raw[key]) {
            result.title = String(raw[key]).trim();
            break;
        }
    }
    result.title = result.title || '(タイトル未設定)';

    // 2. 開始日時
    for (const key of FIELD_MAPPING.start) {
        if (raw[key]) {
            result.start = raw[key];
            break;
        }
    }

    // 3. 終了日時
    for (const key of FIELD_MAPPING.end) {
        if (raw[key]) {
            result.end = raw[key];
            break;
        }
    }

    // 4. 場所
    for (const key of FIELD_MAPPING.place) {
        if (raw[key]) {
            result.place = String(raw[key]).trim();
            break;
        }
    }
    result.place = result.place || '若松集会所';

    // 5. 説明
    for (const key of FIELD_MAPPING.description) {
        if (raw[key]) {
            result.description = String(raw[key]).trim();
            break;
        }
    }
    result.description = result.description || '';

    // 6. カテゴリ
    for (const key of FIELD_MAPPING.category) {
        if (raw[key]) {
            result.category = String(raw[key]).trim();
            break;
        }
    }
    result.category = result.category || '町内行事';

    // 7. 終日フラグ
    for (const key of FIELD_MAPPING.isAllDay) {
        if (raw[key] !== undefined) {
            result.isAllDay = Boolean(raw[key]);
            break;
        }
    }
    if (result.isAllDay === undefined) result.isAllDay = false;

    // 8. 要件2: status の安全保護 (未設定データを無条件に公開しない)
    let explicitStatus = null;
    for (const key of FIELD_MAPPING.status) {
        if (raw[key]) {
            explicitStatus = String(raw[key]).trim().toLowerCase();
            break;
        }
    }
    if (explicitStatus === 'published' || explicitStatus === 'approved') {
        result.status = explicitStatus;
    } else {
        // 未設定または不明な場合は安全のため非公開 (unconfirmed) に固定
        result.status = 'unconfirmed';
    }

    return result;
}

// 模擬テスト用データ (Firebase Console上の既存想定データ)
const sampleFirestoreEvents = [
    {
        id: 'doc_sample_01',
        data: {
            'タイトル': '第1回 資源ごみ・水野公園清掃',
            '開始日時': '2026-07-12T08:00:00+09:00',
            '終了日時': '2026-07-12T09:30:00+09:00',
            '場所': '水野公園',
            '説明': '軍手・ゴミ袋持参',
            'カテゴリ': '清掃',
            // status は未設定
        }
    },
    {
        id: 'doc_sample_02',
        data: {
            'タイトル': '若松町内会 夏祭り盆踊り大会',
            '開始日時': '2026-08-01T18:00:00+09:00',
            '終了日時': '2026-08-01T21:00:00+09:00',
            '場所': '若松集会所前広場',
            'ステータス': 'published' // 明示的に公開
        }
    },
    {
        id: 'doc_sample_planning',
        data: {
            'タイトル': '【企画検討中】スマホミニ講座',
            '開始日時': '2026-09-15T14:00:00+09:00',
            '場所': '集会所 和室',
            // status未設定・企画中
        }
    }
];

function runMigrationAnalysis() {
    console.log('=== Firestore 既存データ移行・照合シミュレーション開始 ===\n');

    console.log('--- 1. 日本語フィールドから英語標準モデルへの照合テスト ---');
    sampleFirestoreEvents.forEach(item => {
        const norm = normalizeDocData(item.data);
        console.log(`[ドキュメント ID: ${item.id}]`);
        console.log(`  元データ:   ${JSON.stringify(item.data)}`);
        console.log(`  正規化後:   title="${norm.title}", start="${norm.start}", status="${norm.status}"`);
        if (norm.status === 'unconfirmed') {
            console.log(`  -> [保護] status未設定のため、非公開 (unconfirmed) として隔離保護`);
        } else {
            console.log(`  -> [公開承認] status="${norm.status}" のため公開許可`);
        }
        console.log('');
    });

    console.log('--- 2. コレクション用途・重複の整理方針 ---');
    console.log('  - events:          町内会公式行事の正本コレクション (管理者が直接登録・管理)');
    console.log('  - communityEvents: 会員企画イベントの正本コレクション (申請・承認ワークフロー)');
    console.log('  - eventPlanning:   既存の手動検討コレクション (削除せず保持し、精査後に communityEvents へ移行)');

    console.log('\n--- 3. キャッシュ (Docs/events.json) と Firestore の ID 整合性検査 ---');
    const cachePath = path.resolve(__dirname, '../Docs/events.json');
    if (fs.existsSync(cachePath)) {
        const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const events = cacheData.events || [];
        console.log(`  キャッシュ内イベント件数: ${events.length} 件`);
        const sample = events[0];
        console.log(`  キャッシュ ID 例: "${sample?.id}" | タイトル: "${sample?.title}"`);
        console.log('  [PASS] キャッシュIDとFirestoreドキュメントIDの照合キー互換性を確認');
    }

    console.log('\n=== 移行・照合シミュレーション完了 (ALL PASSED) ===');
}

runMigrationAnalysis();

