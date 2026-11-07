# GitHub Pages 公開・デプロイ手順書

本システムは、GitHub Actions を利用して静的アセットを自動ビルドし、**GitHub Pages** へ公開します。  
**GitHubへのpush、Secretsの設定変更、本番公開は、必ず承認を得てから実施します。**

---

## 1. 事前準備：GitHub Secrets の設定確認

公開リポジトリ（`https://github.com/wakamatsu-community/-wakamatsu-community.git`）の **Settings > Secrets and variables > Actions** にて、以下の Secrets が登録されていることを確認します。

| Secret名 | 必須 | 説明 / 設定値の例 |
| :--- | :---: | :--- |
| `GAS_WEB_APP_URL` | ○ | GAS Webアプリの公開URL (`https://script.google.com/macros/s/.../exec`) |
| `FIREBASE_API_KEY` | ○ | Firebase Web APIキー (公開設定情報) |
| `FIREBASE_AUTH_DOMAIN` | ○ | 例: `wakamatu-hp.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | ○ | 例: `wakamatu-hp` |
| `FIREBASE_STORAGE_BUCKET` | - | 例: `wakamatu-hp.firebasestorage.app` |
| `FIREBASE_APP_ID` | ○ | 例: `1:118062518569:web:...` |

> [!CAUTION]
> `FIREBASE_SERVICE_ACCOUNT`（サービスアカウント秘密鍵）は、ビルド時やフロントエンドには絶対に注入しません。GitHub Pages（公開サイト）に秘密鍵を露出させないよう厳重に管理してください。

---

## 2. GitHub Pages の公開フロー

```
[開発ブランチ (feature/investigation-and-redesign)]
     │
     │ (承認後に main へマージ & push)
     ▼
[GitHub Actions: Build and Deploy GitHub Pages]
     │
     ├─ 1. コードのチェックアウト & Python環境セットアップ
     ├─ 2. GAS Web App の疎通確認 (check_gas_web_app.py)
     ├─ 3. staticビルド実行 (build_pages.py --mode ci)
     │     └─ Secrets から runtime-config.js を生成して dist/ に注入
     ├─ 4. runtime-config.js の構文・内容検証
     └─ 5. actions/deploy-pages により dist/ を GitHub Pages へ配信
```

---

## 3. 手動でのローカルビルド・検証手順

公開前にローカル環境でビルドと表示確認を行う手順です。

### 3-1. ローカルビルドの実行
PowerShell にて以下を実行します：

```powershell
python scripts/build_pages.py --mode local
```

`.env.local` の設定値が読み込まれ、`dist/` フォルダ配下に公開用静的サイト一式が生成されます。

### 3-2. ローカルサーバーでの動作確認
ビルド成果物（`dist/`）をローカルWebサーバーで配信して確認します：

```powershell
cd dist
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開き、以下の各画面の表示・遷移を確認します：
- トップページ (`index.html`)
- 行事予定 (`events.html`)
- 備品予約 (`equipment.html`)
- 地域マップ (`map.html`)
- 防災情報 (`disaster.html`)
- 回覧板・資料室 (`documents.html`)
- 写真アルバム (`gallery.html`)
- 情報交換 (`opinion.html`)
- 管理ページ (`admin.html`)

---

## 4. 本番デプロイ時のチェックリスト

- [ ] ローカル構文検査・表示テストがすべてパスしていること
- [ ] 機密情報（秘密鍵、個人情報、平文パスワード）がコミットに含まれていないこと
- [ ] 作業ブランチの差分（`git diff`）を確認済みであること
- [ ] ユーザーの承認を得ていること

