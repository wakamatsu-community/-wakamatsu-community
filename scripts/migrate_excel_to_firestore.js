#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const XLSX = require('xlsx');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_WORKBOOK = path.join(PROJECT_ROOT, '福山市若松町内会_管理台帳.xlsx');
const FIRESTORE_TARGETS = [
  { sheetName: '町内行事予定', collectionName: 'events' },
  { sheetName: 'イベント企画', collectionName: 'eventPlanning' },
];
const HEADER_SEARCH_LIMIT = 50;
const EVENT_ID_KEY = normalizeLabel('イベントID');

function parseArgs(argv) {
  const result = {
    file: DEFAULT_WORKBOOK,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--file' || token === '-f') {
      result.file = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--dry-run') {
      result.dryRun = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      result.help = true;
    }
  }

  return result;
}

function showHelp() {
  console.log([
    'Usage:',
    '  node scripts/migrate_excel_to_firestore.js --file "福山市若松町内会_管理台帳.xlsx"',
    '  node scripts/migrate_excel_to_firestore.js --dry-run',
    '',
    'Options:',
    '  --file, -f   Excel ファイルのパス',
    '  --dry-run    Firestore へ書き込まず、読み取り結果だけ表示する',
    '  --help, -h   このヘルプを表示する',
  ].join('\n'));
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/[\s\u3000]+/g, '')
    .trim()
    .toLowerCase();
}

function columnName(index) {
  let current = index + 1;
  let label = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }

  return label;
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

function normalizeFirestoreValue(value) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedArray = value
      .map((item) => normalizeFirestoreValue(item))
      .filter((item) => item !== undefined);
    return normalizedArray.length > 0 ? normalizedArray : undefined;
  }

  if (typeof value === 'object') {
    const normalizedObject = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedNestedValue = normalizeFirestoreValue(nestedValue);
      if (normalizedNestedValue !== undefined) {
        normalizedObject[key] = normalizedNestedValue;
      }
    }

    return Object.keys(normalizedObject).length > 0 ? normalizedObject : undefined;
  }

  return value;
}

function rowHasContent(row) {
  return row.some((cell) => !isEmptyValue(cell));
}

function findHeaderRowIndex(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, HEADER_SEARCH_LIMIT); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const normalizedCells = row.map(normalizeLabel);

    if (normalizedCells.some((cell) => cell === EVENT_ID_KEY || cell.includes(EVENT_ID_KEY))) {
      return rowIndex;
    }
  }

  return -1;
}

function buildRowObject(headers, row) {
  const record = {};

  headers.forEach((header, index) => {
    if (!header) {
      return;
    }

    const normalizedValue = normalizeFirestoreValue(row[index]);
    if (normalizedValue !== undefined) {
      record[header] = normalizedValue;
    }
  });

  return record;
}

function getServiceAccount() {
  const envValue = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envValue) {
    return JSON.parse(envValue);
  }

  const localEnvPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(localEnvPath)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT が未設定です。環境変数、または .env.local を用意してください。');
  }

  const localEnv = fs.readFileSync(localEnvPath, 'utf8');
  const extracted = extractServiceAccountFromEnvFile(localEnv);
  if (!extracted) {
    throw new Error('.env.local から FIREBASE_SERVICE_ACCOUNT を読み取れませんでした。');
  }

  return JSON.parse(extracted);
}

function extractServiceAccountFromEnvFile(content) {
  const lines = content.split(/\r?\n/);
  const keyPrefix = 'FIREBASE_SERVICE_ACCOUNT=';
  let collecting = false;
  let buffer = '';
  let braceDepth = 0;

  for (const line of lines) {
    if (!collecting) {
      if (!line.startsWith(keyPrefix)) {
        continue;
      }

      collecting = true;
      buffer = line.slice(keyPrefix.length);
      braceDepth += countBraceDelta(buffer);
      if (braceDepth <= 0 && buffer.trim()) {
        return buffer.trim();
      }
      continue;
    }

    buffer += `\n${line}`;
    braceDepth += countBraceDelta(line);

    if (braceDepth <= 0) {
      return buffer.trim();
    }
  }

  return buffer.trim() || null;
}

function countBraceDelta(text) {
  let delta = 0;

  for (const char of String(text)) {
    if (char === '{') {
      delta += 1;
    } else if (char === '}') {
      delta -= 1;
    }
  }

  return delta;
}

function initializeFirestore() {
  const serviceAccount = getServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin.firestore();
}

function readWorksheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`シート "${sheetName}" が見つかりません。`);
  }

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
}

async function importSheet(db, workbook, target, dryRun) {
  const rows = readWorksheetRows(workbook, target.sheetName);
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex < 0) {
    throw new Error(`シート "${target.sheetName}" で ヘッダー行を見つけられませんでした。`);
  }

  const headerRow = rows[headerRowIndex] || [];
  const headers = headerRow.map((value, index) => {
    const text = String(value ?? '').trim();
    return text || `column_${columnName(index)}`;
  });
  const eventIdColumnIndex = headers.findIndex((header) => normalizeLabel(header) === EVENT_ID_KEY);

  if (eventIdColumnIndex < 0) {
    throw new Error(`シート "${target.sheetName}" に "イベントID" 列がありません。`);
  }

  const dataRows = rows.slice(headerRowIndex + 1).filter(rowHasContent);
  console.log(`\n[${target.sheetName}] ${dataRows.length} 行を処理します。`);

  let importedCount = 0;
  let skippedCount = 0;
  let duplicateCount = 0;
  const seenIds = new Set();

  if (dryRun) {
    for (let index = 0; index < dataRows.length; index += 1) {
      const row = dataRows[index];
      const rowObject = buildRowObject(headers, row);
      const eventId = String(row[eventIdColumnIndex] ?? '').trim();

      if (!eventId) {
        skippedCount += 1;
        console.warn(`[${target.sheetName}] ${headerRowIndex + index + 2} 行目は イベントID が空のためスキップしました。`);
        continue;
      }

      if (seenIds.has(eventId)) {
        duplicateCount += 1;
        console.warn(`[${target.sheetName}] イベントID ${eventId} は重複しています。後続データで上書きされます。`);
      }

      seenIds.add(eventId);
      importedCount += 1;
      console.log(`[dry-run] ${target.collectionName}/${eventId}`, rowObject);
    }

    console.log(`[${target.sheetName}] dry-run 完了: imported=${importedCount}, skipped=${skippedCount}, duplicates=${duplicateCount}`);
    return;
  }

  if (!db) {
    throw new Error('Firestore 初期化に失敗しました。');
  }

  const writer = db.bulkWriter();

  writer.onWriteError((error) => {
    console.error(`[${target.sheetName}] 書き込み失敗 ${error.documentRef.path} (${error.failedAttempts} 回目): ${error.message}`);
    return error.failedAttempts < 3;
  });

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const rowObject = buildRowObject(headers, row);
    const eventId = String(rowObject[headers[eventIdColumnIndex]] ?? '').trim();
    const lineNumber = headerRowIndex + index + 2;

    if (!eventId) {
      skippedCount += 1;
      console.warn(`[${target.sheetName}] ${lineNumber} 行目は イベントID が空のためスキップしました。`);
      continue;
    }

    if (seenIds.has(eventId)) {
      duplicateCount += 1;
      console.warn(`[${target.sheetName}] イベントID ${eventId} は重複しています。後続データで上書きされます。`);
    }

    seenIds.add(eventId);
    const docRef = db.collection(target.collectionName).doc(eventId);

    writer.set(docRef, rowObject);
    importedCount += 1;
    console.log(`[${target.sheetName}] 送信予定: ${target.collectionName}/${eventId} (行 ${lineNumber})`);
  }

  await writer.close();
  console.log(`[${target.sheetName}] 完了: imported=${importedCount}, skipped=${skippedCount}, duplicates=${duplicateCount}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    return;
  }

  const workbookPath = path.resolve(args.file);
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Excel ファイルが見つかりません: ${workbookPath}`);
  }

  console.log(`Excel ファイル: ${workbookPath}`);
  console.log(`モード: ${args.dryRun ? 'dry-run' : 'Firestore へ書き込み'}`);

  const workbook = XLSX.readFile(workbookPath, {
    cellDates: true,
  });

  const db = args.dryRun ? null : initializeFirestore();

  for (const target of FIRESTORE_TARGETS) {
    await importSheet(db, workbook, target, args.dryRun);
  }

  console.log('\n移行処理が完了しました。');
}

main().catch((error) => {
  console.error('\n移行処理に失敗しました。');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});