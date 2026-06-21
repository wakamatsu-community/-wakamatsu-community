#!/usr/bin/env node
'use strict';

/**
 * Firestore サンプルデータ投入スクリプト
 *
 * GASスプレッドシートの列定義に合わせた Firestore コレクション構造:
 *
 * events コレクション（← 町内行事予定シート）
 *   イベントID      : ドキュメントID兼フィールド
 *   カレンダー予定ID : string  Google Calendar イベントID
 *   開始日時         : string  ISO8601 (例: 2026-07-20T09:00:00)
 *   終了日時         : string  ISO8601
 *   タイトル         : string
 *   企画者           : string
 *   場所             : string
 *   説明             : string
 *
 * eventPlanning コレクション（← イベント企画シート）
 *   イベントID      : ドキュメントID兼フィールド
 *   カレンダー予定ID : string
 *   開始日時         : string  ISO8601
 *   終了日時         : string  ISO8601
 *   タイトル         : string
 *   企画者           : string
 *   場所             : string
 *   最少人数         : number
 *   最大人数         : number
 *   説明             : string
 *
 * Usage:
 *   node scripts/seed_firestore.js
 *   node scripts/seed_firestore.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    return JSON.parse(raw);
  }

  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT が未設定です。.env.local を用意してください。');
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const prefix = 'FIREBASE_SERVICE_ACCOUNT=';
  let collecting = false;
  let buffer = '';
  let depth = 0;

  for (const line of content.split(/\r?\n/)) {
    if (!collecting) {
      if (!line.startsWith(prefix)) {
        continue;
      }
      collecting = true;
      buffer = line.slice(prefix.length);
      for (const c of buffer) {
        if (c === '{') {
          depth += 1;
        } else if (c === '}') {
          depth -= 1;
        }
      }
      if (depth <= 0 && buffer.trim()) {
        return JSON.parse(buffer.trim());
      }
      continue;
    }

    buffer += `\n${line}`;
    for (const c of line) {
      if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      }
    }
    if (depth <= 0) {
      return JSON.parse(buffer.trim());
    }
  }

  throw new Error('.env.local から FIREBASE_SERVICE_ACCOUNT を読み取れませんでした。');
}

// =============================================================
// サンプルデータ定義（GASスプレッドシートの列定義と完全一致）
// =============================================================

const EVENTS_SEED = [
  {
    'イベントID': 'TC-2026-001',
    'カレンダー予定ID': '',
    '開始日時': '2026-07-20T09:00:00',
    '終了日時': '2026-07-20T12:00:00',
    'タイトル': '夏祭り（若松盆踊り）',
    '企画者': '若松町内会',
    '場所': '若松集会所前広場',
    '説明': '毎年恒例の盆踊り大会です。ご家族でご参加ください。'
  },
  {
    'イベントID': 'TC-2026-002',
    'カレンダー予定ID': '',
    '開始日時': '2026-09-06T08:00:00',
    '終了日時': '2026-09-06T10:00:00',
    'タイトル': '秋季一斉清掃',
    '企画者': '若松町内会',
    '場所': '若松町内全域',
    '説明': '地域の清掃活動を行います。軍手・ゴミ袋をご持参ください。'
  },
  {
    'イベントID': 'TC-2026-003',
    'カレンダー予定ID': '',
    '開始日時': '2026-10-18T13:00:00',
    '終了日時': '2026-10-18T16:00:00',
    'タイトル': '防災訓練',
    '企画者': '若松町内会',
    '場所': '若松小学校グラウンド',
    '説明': '年1回の防災訓練です。消火器体験・AED体験を実施します。'
  }
];

const EVENT_PLANNING_SEED = [
  {
    'イベントID': 'EV-2026-001',
    'カレンダー予定ID': '',
    '開始日時': '2026-07-12T14:00:00',
    '終了日時': '2026-07-12T16:00:00',
    'タイトル': 'スマホお助け茶話会（7月）',
    '企画者': '若松コミュニティ',
    '場所': '若松集会所 和室',
    '最少人数': 3,
    '最大人数': 15,
    '説明': 'スマホ操作でお困りの方、お気軽にどうぞ。LINEの使い方など何でも。'
  },
  {
    'イベントID': 'EV-2026-002',
    'カレンダー予定ID': '',
    '開始日時': '2026-08-09T14:00:00',
    '終了日時': '2026-08-09T16:00:00',
    'タイトル': 'スマホお助け茶話会（8月）',
    '企画者': '若松コミュニティ',
    '場所': '若松集会所 和室',
    '最少人数': 3,
    '最大人数': 15,
    '説明': '8月の茶話会です。写真の送り方・アプリの入れ方などご相談ください。'
  },
  {
    'イベントID': 'EV-2026-003',
    'カレンダー予定ID': '',
    '開始日時': '2026-07-26T10:00:00',
    '終了日時': '2026-07-26T12:00:00',
    'タイトル': '手芸クラブ（夏の小物づくり）',
    '企画者': '若松コミュニティ',
    '場所': '若松集会所 大広間',
    '最少人数': 5,
    '最大人数': 20,
    '説明': '余り布でエコバッグを作ります。材料は用意します。経験不問！'
  }
];

async function upsertCollection(db, collectionName, rows) {
  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    const idField = row['イベントID'];
    if (!idField) {
      console.warn(`[${collectionName}] イベントID が空の行をスキップしました:`, row['タイトル']);
      continue;
    }

    const docRef = db.collection(collectionName).doc(String(idField).trim());

    if (DRY_RUN) {
      console.log(`[dry-run] ${collectionName}/${idField}:`, JSON.stringify(row));
    } else {
      batch.set(docRef, row);
    }

    count += 1;
  }

  if (!DRY_RUN) {
    await batch.commit();
  }

  console.log(`[${collectionName}] ${count} 件を${DRY_RUN ? 'dry-run で確認' : '投入'}しました。`);
}

async function main() {
  console.log(`モード: ${DRY_RUN ? 'dry-run（Firestore 書き込みなし）' : 'Firestore へ書き込み'}`);

  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  const db = admin.firestore();

  await upsertCollection(db, 'events', EVENTS_SEED);
  await upsertCollection(db, 'eventPlanning', EVENT_PLANNING_SEED);

  console.log('\n完了しました。');
}

main().catch((error) => {
  console.error('\n失敗しました。');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
