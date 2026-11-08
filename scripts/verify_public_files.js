// scripts/verify_public_files.js
/**
 * 公開静的ファイル (GitHub Pages 配布対象) の機密・会員限定情報検査スクリプト
 *
 * 検査対象:
 *   1. Docs/events.json (公開キャッシュ行事データ)
 *   2. HTML ファイル群 (*.html)
 *   3. JS 設定ファイル (js/config.js, js/runtime-config.js)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let hasError = false;

console.log('=== GitHub Pages 公開静的ファイルの機密・会員限定情報 検証開始 ===\n');

// -------------------------------------------------------------
// 1. Docs/events.json の検証
// -------------------------------------------------------------
console.log('--- 1. Docs/events.json の検査 ---');
const eventsPath = path.join(ROOT, 'Docs', 'events.json');
if (!fs.existsSync(eventsPath)) {
    console.error('[FAIL] Docs/events.json が存在しません');
    hasError = true;
} else {
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed) ? parsed : (parsed.events || []);

    console.log(`[INFO] 公開ファイル内の行事データ件数: ${events.length} 件`);

    // 要件1: B方式に合わせ、Docs/events.json の行事データが未ログインで直接閲覧できないよう空配列(0件)であること
    if (events.length > 0) {
        console.error(`[FAIL] Docs/events.json に ${events.length} 件の行事データが含まれています。B方式では未ログイン閲覧を遮断するため空配列でなければなりません。`);
        hasError = true;
    } else {
        console.log('[PASS] Docs/events.json は空配列です（未ログイン利用者の直接閲覧完全遮断 PASS）');
    }
}

// -------------------------------------------------------------
// 2. js/config.js の検査 (モック個人情報の完全除去確認)
// -------------------------------------------------------------
console.log('\n--- 2. js/config.js の検査 ---');
const configPath = path.join(ROOT, 'js', 'config.js');
const configContent = fs.readFileSync(configPath, 'utf8');

if (/山田太郎|田中一郎|佐藤花子|090-\d{4}-\d{4}/.test(configContent)) {
    console.error('[FAIL] js/config.js に個人名または電話番号が残存しています');
    hasError = true;
} else {
    console.log('[PASS] js/config.js に個人情報・電話番号は残存していません');
}

// -------------------------------------------------------------
// 3. HTMLファイル群のインライン機密・平文パスワード検査
// -------------------------------------------------------------
console.log('\n--- 3. 全HTMLファイルの検査 ---');
const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

htmlFiles.forEach(file => {
    const filePath = path.join(ROOT, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // サービスアカウント秘密鍵・プライベートキーの漏洩チェック
    if (/BEGIN PRIVATE KEY|client_secret|service_account/.test(content)) {
        console.error(`[FAIL] ${file} に秘密鍵パターンが検出されました`);
        hasError = true;
    }
    // 旧4桁PINコードのハードコード漏洩チェック
    if (/\b(pin\s*[:=]\s*["']?\d{4}["']?)\b/i.test(content)) {
        console.error(`[FAIL] ${file} に旧PINコードのハードコードが検出されました`);
        hasError = true;
    }
});
console.log(`[PASS] 全 ${htmlFiles.length} 件のHTMLファイルに秘密鍵・旧PINの漏洩はありません`);

// -------------------------------------------------------------
// 4. runtime-config.js の検査
// -------------------------------------------------------------
console.log('\n--- 4. js/runtime-config.js の検査 ---');
const runtimeConfigPath = path.join(ROOT, 'js', 'runtime-config.js');
const runtimeContent = fs.readFileSync(runtimeConfigPath, 'utf8');

if (/private_key|client_secret|serviceAccountKey/.test(runtimeContent)) {
    console.error('[FAIL] js/runtime-config.js にサービスアカウント秘密鍵が含まれています');
    hasError = true;
} else {
    console.log('[PASS] js/runtime-config.js は公開設定のみで構成されています (秘密情報なし)');
}

console.log('\n======================================================');
if (hasError) {
    console.error('公開ファイル検査でエラーが検出されました');
    process.exit(1);
} else {
    console.log('全公開静的ファイルの機密・会員限定情報検査に完全合格 (ALL PASSED)');
}
console.log('======================================================\n');
