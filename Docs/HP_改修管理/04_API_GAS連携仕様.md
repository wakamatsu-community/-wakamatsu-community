# API・Security Rules・GAS連携仕様書

## 1. 概要

本システムでは、データの読み書き・検索・トランザクション排他制御を **Cloud Firestore Web SDK** 経由でブラウザから直接実行し、アクセスコントロールを **Firestore Security Rules** で強制する。  
大容量ファイル（写真・PDF資料）の保存には **Google Drive**（無料15GB）を利用し、ファイル作成・フォルダ管理処理を **Google Apps Script (GAS)** が担当する。

---

## 2. Firestore Security Rules（アクセス制御ルール定義）

以下のルールを Firebase Console の Firestore ルールへデプロイし、データベース層でのアクセス権限を完全に強制する。

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 役員（管理者）判定ヘルパー
    function isOfficer() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'officer';
    }

    // 会員（ログイン済み）判定ヘルパー
    function isMember() {
      return request.auth != null;
    }

    // 本人判定ヘルパー
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    // 会員プロファイル (users)
    match /users/{userId} {
      allow read: if isMember();
      allow create: if isOwner(userId) && request.resource.data.role == 'member'; // 新規登録時は一般会員
      allow update: if isOfficer() || (isOwner(userId) && request.resource.data.role == resource.data.role); // 役員変更は役員のみ
      allow delete: if isOfficer();
    }

    // 公式行事予定 (events)
    match /events/{eventId} {
      allow read: if true; // 住民全員（未ログイン含む）が閲覧可能
      allow write: if isOfficer(); // 作成・変更・削除は役員のみ
    }

    // 会員企画イベント (communityEvents)
    match /communityEvents/{eventId} {
      allow read: if resource.data.status == 'approved' || isOfficer() || isOwner(resource.data.organizerUid);
      allow create: if isMember() && request.resource.data.status == 'pending';
      allow update: if isOfficer() || (isOwner(resource.data.organizerUid) && resource.data.status == 'pending');
      allow delete: if isOfficer() || isOwner(resource.data.organizerUid);

      // イベント参加者 (entries)
      match /entries/{entryId} {
        allow read: if isOfficer() || isOwner(resource.data.uid) || isOwner(get(/databases/$(database)/documents/communityEvents/$(eventId)).data.organizerUid);
        allow create: if isMember() && isOwner(request.resource.data.uid);
        allow update, delete: if isOfficer() || isOwner(resource.data.uid);
      }
    }

    // 備品マスタ (equipmentMaster)
    match /equipmentMaster/{equipmentId} {
      allow read: if true; // 在庫数・説明は誰でも閲覧可能
      allow write: if isOfficer(); // マスタ編集は役員のみ
    }

    // 備品予約台帳 (equipmentReservations)
    match /equipmentReservations/{reservationId} {
      // 空き状況確認のため日付・数量・備品名は公開、個人情報は役員・本人のみ
      allow read: if true;
      allow create: if isMember() && request.resource.data.userUid == request.auth.uid;
      allow update: if isOfficer() || (isOwner(resource.data.userUid) && resource.data.status == 'requested');
      allow delete: if isOfficer();
    }

    // 意見交換・相談 (opinions)
    match /opinions/{opinionId} {
      allow read: if resource.data.isPublic == true || isOfficer() || (request.auth != null && resource.data.userUid == request.auth.uid);
      allow create: if true; // 匿名投稿も受け付ける場合は true
      allow update: if isOfficer(); // 返信やステータス更新は役員のみ
      allow delete: if isOfficer();
    }

    // 回覧板・資料室 (documents)
    match /documents/{docId} {
      // 会員限定フラグが立っている資料はログイン会員のみ閲覧可能
      allow read: if resource.data.isRestricted == false || isMember();
      allow write: if isOfficer();
    }

    // 写真アルバム (photos)
    match /photos/{photoId} {
      allow read: if resource.data.status == 'approved' || isOfficer() || isOwner(resource.data.uploaderUid);
      allow create: if isMember() && request.resource.data.status == 'pending';
      allow update: if isOfficer(); // 承認操作は役員のみ
      allow delete: if isOfficer() || isOwner(resource.data.uploaderUid);
    }
  }
}
```

---

## 3. Google Drive と GAS の連携方式（保存・閲覧・削除）

### 3-1. 写真・PDFのアップロードフロー

1. **クライアント側前処理**:
   - スマホから選択された写真（5〜15MB）を、HTML5 Canvas API を用いて最大長辺 1200px、JPEG品質 0.8 に自動縮小（約 200〜400KB に軽量化）。
2. **Firebase Auth トークン取得**:
   - `const idToken = await auth.currentUser.getIdToken();`
3. **GAS Web App への送信**:
   - `fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "uploadFile", idToken, fileName, mimeType, fileData: base64, category }) })`
4. **GAS 側での検証と Drive 保存**:
   - GAS は Google のトークン情報エンドポイント（`https://oauth2.googleapis.com/tokeninfo?id_token=` + `idToken`）へ問い合わせ、有効な Firebase 認証トークンであることを検証。
   - DriveApp を用いて指定の共有フォルダにファイルを保存。
   - レスポンスとして `{ ok: true, driveFileId, viewUrl, thumbnailUrl }` を返却。
5. **Firestore へのメタデータ登録**:
   - クライアントは返却された URL とメタデータを Firestore（`photos` または `documents`）へ登録（ステータス: `pending`）。

### 3-2. ファイルの閲覧とアクセス制御の成立性検証

Firebase SparkプランではCloud Storage for Firebaseを使用せず、**Google Drive（無料15GB）に一本化**する。
ファイルの機密レベルに応じた閲覧・アクセス制御方針は以下の通り：

| 資料区分 | 保存先・共有設定 | 配信方式 | セキュリティ・アクセス制御 |
| :--- | :--- | :--- | :--- |
| **会員限定資料（議事録・役員名簿等）** | Google Drive（町内会管理者のみアクセス可の非公開フォルダ） | **GASセキュア配信 (`getSecureDocumentContent`)** | ◎ **完全保護**。Driveの直URLは公開せず、ブラウザからFirebase IDトークンを送信。GAS側でGoogle公開エンドポイント検証に成功した場合のみBase64で返却。 |
| **一般回覧板・広報PDF** | Google Drive（リンクを知る全員が閲覧可フォルダ） | Drive直接リンク / PDF埋め込み | ○ 住民全員がログイン不要で閲覧可能。ファイルURLはランダムハッシュで推測困難。 |
| **写真アルバム（ギャラリー）** | Google Drive（共有写真フォルダ） | Drive直接画像表示 (`uc?export=view&id=...`) | ○ 投稿時にFirebase IDトークンをGASで検証。役員による「承認制」で安全性を担保。未承認写真は表示しない。 |

#### GASプロキシ配信の制限事項と対策：
1. **同時実行数制限**: Google無料アカウントのGAS Webアプリは同時実行数30接続。会員限定資料（議事録等）は同時アクセス頻度が低いため制限内に余裕で収まる。
2. **容量制限**: 1リクエストのBase64返却サイズはGAS制限（50MB）未満である必要があり、資料PDFは10MB以内を推奨。
3. **実行時間制限**: Webアプリ呼び出しは1回あたり最大数秒で完了するため、GAS実行時間上限（6分）に抵触しない。

### 3-3. ファイルの削除方式
役員または投稿者が管理画面から「削除」を実行した場合：
1. **Firestore 上のメタデータ削除/論理削除**:
   - `photos` または `documents` のドキュメントを削除（または `status: "deleted"` に更新）。
2. **Google Drive 上のファイルをゴミ箱移動**:
   - GAS Webアプリへ `action: "deleteDriveFile"`, `fileId`, `idToken`, `fileType` を送信。
   - GAS 側で IDトークンを検証後、`DriveApp.getFileById(fileId).setTrashed(true)` を実行してゴミ箱へ移動。
   - スプレッドシート（写真メタデータ/文書メタデータ）の保管状態を「削除済」に更新。
