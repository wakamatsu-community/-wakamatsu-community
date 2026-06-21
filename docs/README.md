# 若松町町内会ポータルサイト

## はじめて担当する方向け

- 取扱説明書: [取扱説明書_町内会ホームページ.md](取扱説明書_町内会ホームページ.md)

ホームページは**表示専用ポータル**として動作します。  
管理者は Google Drive / Calendar / Forms / Sheets / My Maps のみを操作します。ホームページのコードを直接編集する必要はありません。

---

## ファイル構成

```
/
├ index.html          トップページ（ポータル入口）
├ events.html         行事予定（Google Calendar埋込）
├ equipment.html      備品予約（Google Forms）
├ map.html            地域マップ（Google My Maps）
├ disaster.html       防災情報
├ documents.html      回覧板・資料室（Google Drive連携）
├ gallery.html        写真アルバム（Google Drive連携）
├ admin.html          管理画面（将来拡張用）
├ style.css           共通スタイル
├ script.js           後方互換スクリプト
├ js/
│  ├ config.js        ← URLの一元管理（ここだけ編集）
│  ├ main.js          エントリーポイント
│  ├ calendar.js      カレンダー埋込
│  ├ drive.js         Driveドキュメント表示
│  ├ map.js           マップ埋込
│  ├ form.js          フォーム連携
│  ├ trash.js         ゴミ収集案内（Sheets連携）
│  └ gallery.js       写真アルバム
├ assets/             静的アセット
├ images/             画像ファイル
└ Docs/               ローカルドキュメント
```

---

## ローカル起動方法

### 推奨: 環境変数を注入して起動

1. `.env.local.example` をコピーして `.env.local` を作成
2. `GOOGLE_CALENDAR_API_KEY` / `GOOGLE_CALENDAR_ID`（必要に応じて Firebase）を設定
3. ビルド実行:

```bash
python scripts/build_pages.py --mode local
```

4. `dist/` を配信:

```bash
cd dist
python -m http.server 8000
```

→ ブラウザで `http://localhost:8000/` を開く。

### 補足（環境変数不要の表示確認）

Live Server（VS Code 拡張）で `index.html` を直接開くことも可能です。
ただしこの場合、Google Calendar API/Firebase は環境変数未注入のため連携されません。
GAS 連携も同様に未注入です。GAS 接続を確認する場合は、必ず `python scripts/build_pages.py --mode local` 実行後の `dist/` を配信してください。

---

## GitHub Pages 公開方法

このリポジトリは GitHub Actions で `dist/` をビルドして公開します。

1. GitHub Secrets を設定
2. `main` に push
3. Actions `Build and Deploy GitHub Pages` が実行
4. ビルド時に Secrets を `js/runtime-config.js` へ注入して公開

重要:

- ルート直下の `js/runtime-config.js` は開発用のひな形です。実運用で使われる値は `dist/js/runtime-config.js` に注入されます。
- Apps Script のコードを更新しただけでは公開中 Web アプリは自動更新されません。Apps Script 側で Web アプリを再デプロイしてください。
- Web アプリのアクセス権は、GitHub Pages から呼ぶ場合「全員」にしておく必要があります。権限不足だと HTML のログイン画面が返り、フロント側では JSON として読めません。
- GitHub Actions ではデプロイ前に `GAS_WEB_APP_URL` へ GET/POST の疎通確認を行います。GAS 側が未デプロイ・権限不足・URL誤りの場合は公開前にジョブが失敗します。

本番接続を優先して確認する最短手順:

1. Apps Script 側で Web アプリを再デプロイ（アクセス: 全員）
2. GitHub Secrets の `GAS_WEB_APP_URL` を確認
3. `main` へ push
4. Actions の `Build and Deploy GitHub Pages` が成功してから公開ページで動作確認

必要な Secrets:

- `GAS_WEB_APP_URL`
- `GOOGLE_CALENDAR_API_KEY`
- `GOOGLE_CALENDAR_ID`
- `FIREBASE_API_KEY`（Firebaseを使う場合）
- `FIREBASE_AUTH_DOMAIN`（Firebaseを使う場合）
- `FIREBASE_PROJECT_ID`（Firebaseを使う場合）
- `FIREBASE_STORAGE_BUCKET`（Firebaseを使う場合）
- `FIREBASE_MESSAGING_SENDER_ID`（Firebaseを使う場合）
- `FIREBASE_APP_ID`（Firebaseを使う場合）
- `FIREBASE_MEASUREMENT_ID`（任意）

Firestore を Node サーバー経由で読む構成に切り替えた場合は、上の Firebase Web 用設定は不要です。必要なのは `FIREBASE_SERVICE_ACCOUNT` だけです。

---

## Excel から Firestore への移行

`福山市若松町内会_管理台帳.xlsx` の `町内行事予定` シートを `events` コレクションへ、`イベント企画` シートを `eventPlanning` コレクションへ投入する Node.js スクリプトを用意しています。各行の `イベントID` がドキュメント ID になります。

### 1. 依存関係を入れる

```bash
npm install
```

### 2. Firebase サービスアカウントを用意する

スクリプトは `FIREBASE_SERVICE_ACCOUNT` を参照します。既に `.env.local` に同名の設定がある場合は、その値を優先的に読み取ります。

PowerShell で直接設定する場合は、実行前に次のように入れてください。

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content .\.firebase-service-account.json -Raw
```

### 3. 実行する

```bash
npm run migrate:firestore -- --file "福山市若松町内会_管理台帳.xlsx"
```

書き込み前に内容だけ確認したい場合は dry-run を使えます。

```bash
npm run migrate:firestore -- --file "福山市若松町内会_管理台帳.xlsx" --dry-run
```

dry-run は Firestore に接続しないため、`FIREBASE_SERVICE_ACCOUNT` の設定なしでも確認できます。

### 4. 想定されるログ

- ヘッダー行の検出結果
- スキップした行数
- `イベントID` の重複警告
- Firestore 書き込みの成功・失敗ログ

---

## Firestore を使う実行方法

この構成では、ブラウザから Firestore を直接読むのではなく、`FIREBASE_SERVICE_ACCOUNT` を使う Node.js サーバー経由で読み込みます。フロント側に Firebase Web 用設定は不要です。

### 1. 依存関係を入れる

```bash
npm install
```

### 2. サーバーを起動する

```bash
npm start
```

### 3. ブラウザで確認する

```text
http://localhost:3000/
```

API は次のように動きます。

```text
GET /api/firestore/events
GET /api/firestore/eventPlanning
GET /api/firestore/events/<docId>
```

### 4. 必要な環境変数

- `FIREBASE_SERVICE_ACCOUNT` のみで足ります
- `FIREBASE_API_KEY` などの Web 用設定は不要です

### 5. ローカルで確認できること

- Firestore への読み取り
- 画面への表示
- ドキュメント ID ごとの取得

GitHub Pages のような完全静的ホスティングでは API サーバーを置けないため、本番でこの方式を使う場合は Node が動くホスティングに切り替える必要があります。

---

## URL の設定変更（js/config.js）

Google サービスの URL はすべて `js/config.js` で一元管理します。  
以下のキーを実際の値に書き換えるだけで連携が完了します。

| キー | 用途 |
|---|---|
| `calendar.mainUrl` | 町内会行事カレンダー埋込 URL |
| `calendar.learningUrl` | 学びの会カレンダー埋込 URL |
| `forms.equipment.*` | 備品予約フォーム URL |
| `drive.circularFolderId` | 回覧板フォルダ ID |
| `drive.disasterManualUrl` | 防災マニュアル PDF URL |
| `trash.sheetUrl` | ゴミ収集スケジュール Sheets URL |
| `map.myMapsUrl` | Google My Maps 埋込 URL |
| `gallery.albums[].driveFolderId` | 写真アルバム フォルダ ID |

---

## Google サービス連携 設定手順

### 1. Google Calendar

1. [Google Calendar](https://calendar.google.com) を開く
2. 対象カレンダーの「...」→「設定と共有」を選択
3. 「このカレンダーを公開する」にチェックを入れて保存
4. 「カレンダーを埋め込む」セクションの `src=` 以降の URL をコピー
5. 町内会行事用は `js/config.js` の `calendar.mainUrl` に貼り付ける
6. 学びの会用は別カレンダーを作成し、`calendar.learningUrl` に貼り付ける

```js
calendar: {
    mainUrl: "https://calendar.google.com/calendar/embed?src=community%40group.calendar.google.com&ctz=Asia%2FTokyo",
    learningUrl: "https://calendar.google.com/calendar/embed?src=learning%40group.calendar.google.com&ctz=Asia%2FTokyo"
}
```

---

### 2. Google Drive（回覧板・写真アルバム）

1. [Google Drive](https://drive.google.com) でフォルダを作成する  
   例: `若松町内会 > 回覧板 > 2026` のように年別に整理
2. フォルダを右クリック → 「共有」→ **リンクを知っている全員** に設定
3. フォルダの URL 末尾にある長い文字列（フォルダ ID）をコピー
4. `js/config.js` の `drive.circularFolderId` に設定する

```js
drive: {
    circularFolderId: "1ABCDEFGabcdef1234567890",
    circularFolderUrl: "https://drive.google.com/drive/folders/1ABCDEFGabcdef1234567890"
}
```

> **将来の Drive API 連携**: `js/drive.js` の `getDriveCircular()` 関数内の  
> `TODO` コメント箇所を Google Drive API の呼び出しへ置き換えます。

---

### 3. Google Forms（備品予約）

1. [Google Forms](https://forms.google.com) でフォームを作成する
2. 送信アイコン →「リンク」タブからフォーム URL をコピー
3. `js/config.js` の `forms` セクションへ貼り付ける

```js
forms: {
    equipment: {
        tent: "https://forms.gle/xxxxxxxxxxxx"
    }
}
```

---

### 4. Google Sheets（ゴミ収集スケジュール）

1. [Google スプレッドシート](https://sheets.google.com) で新規ファイルを作成する
2. 以下の構造で入力する:

| A: dayIndex | B: label | C: types |
|---|---|---|
| 1 | 月曜日 | 燃えるゴミ |
| 4 | 木曜日 | 燃えるゴミ |
| 5 | 金曜日 | 資源ゴミ |

3. ファイル → 共有 → **ウェブに公開** → JSON 形式を選択
4. 発行された URL を `js/config.js` の `trash.sheetUrl` に設定する

```js
trash: {
    sheetUrl: "https://docs.google.com/spreadsheets/d/xxxxx/gviz/tq?tqx=out:json"
}
```

> シートが公開されると `js/trash.js` が自動的に Sheets から読み込みます（モックデータは不要になります）。

---

### 5. Google My Maps（地域マップ）

1. [Google My Maps](https://www.google.com/mymaps) で新規マップを作成する
2. 集会所・避難所・AED・防災倉庫などをピンで追加する
3. 「共有」→ **リンクを知っている全員** に設定
4. 「地図を埋め込む」→ iframe の `src=` URL をコピー
5. `js/config.js` の `map.myMapsUrl` に設定する

```js
map: {
    myMapsUrl: "https://www.google.com/maps/d/u/0/embed?mid=xxxxxxxxxxxxxxxxxx"
}

---

### 6. 写真アルバム投稿（Google Drive）

1. Google Driveで写真保存用の親フォルダを作成
2. 既存の保存先フォルダ（例: 共有、アーカイブ）を作成
3. `js/config.js` の `gallery.destinations[].folderId` に各フォルダIDを設定
4. 写真アップロードを有効にする場合は `gallery.drive.uploadEndpoint` を設定

gallery.html では以下が利用できます。

- 保存先系統の選択（既存フォルダ）
- 複数画像の投稿（Apps Script連携）
```

---

## 将来拡張ポイント

各フラグを `true` に変更することで追加機能を有効化できます（`js/config.js`）:

| フラグ | 機能 |
|---|---|
| `integrations.lineNotify` | LINE 通知 |
| `integrations.driveApiReady` | Drive API（PDF 自動取得） |
| `integrations.calendarApiReady` | Calendar API |
| `integrations.formsApiReady` | Forms API |
| `integrations.sheetsApiReady` | Sheets API（ゴミ収集自動取得） |
| `integrations.googleLoginReady` | Google ログイン（管理画面認証） |
| `integrations.memberManagementReady` | 会員管理 |
| `integrations.aiChatbotReady` | AI チャットボット |
| `integrations.disasterAlertReady` | 防災通知システム |

