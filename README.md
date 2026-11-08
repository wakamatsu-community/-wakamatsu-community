# 若松町内会ホームページ (コミュニケーションボード)

福山市若松町内会のポータルサイトです。

## 概要

- **公開情報閲覧**: ホームページ閲覧はログイン不要です。行事予定、地域マップ、防災情報、回覧板、公開写真、地域相談は誰でも自由に閲覧できます。
- **オンデマンド認証**: 備品予約申請、イベント申込・登録、写真投稿、意見投稿などの会員サービス利用時にログインを要求します。
- **誤送信防止**: ログイン成功後は入力内容を保持したまま元の画面へ復帰し、利用者の手動確認を経て登録されます（自動送信はしません）。
- **権限3区分**:
  - `member`: 一般会員（共通ID `member` ＋ 合言葉 / 各種申請・投稿）
  - `officer`: 責任者（個別ID `officer` / 業務マスタ管理・承認・返納確認）
  - `admin`: システム管理者（個別ID `niina` / 会員ロール管理・特権設定）
- **個人情報保護**: 共通アカウント（member）による他人の予約・参加台帳の閲覧・変更・取消は Cloud Firestore Security Rules により厳格に遮断されています。

## ドキュメント一覧

- [操作取扱説明書 (Docs/取扱説明書_町内会ホームページ.md)](Docs/取扱説明書_町内会ホームページ.md)
- [詳細技術仕様書 (Docs/README.md)](Docs/README.md)

## ローカル開発・検証

```bash
# 全テスト実行
node --experimental-vm-modules scripts/check_syntax.js
node scripts/test_security_rules.js
node scripts/test_auth_error_handling.js
node scripts/test_auth_flow.js
node scripts/test_calendar_performance.js
node scripts/verify_public_files.js
python scripts/validate_code_gs.py
```
