# PJ-029 統合スケジュール・予約管理アプリ

Ver.0.1.3 開発中。

## 現在実装済み
- 月／週／日カレンダー切替
- 予定作成モーダル
- Firestoreから予定をリアルタイム取得
- 予定の画面即時反映（Firebase未設定時はデモモード）
- 会議室／社用車を予定に紐付ける入力
- 同一設備・同一日の時間帯重複チェック
- メール通知・Teams通知キューの作成
- 全画面共通フィードバックボタン
- Firebase / Firestore接続基盤
- `events` / `reservations` / `feedbacks` / `notifications` への保存処理
- PC / iPhone向けレスポンシブ基本設計

## Firebase設定
`.env.example` を `.env.local` にコピーし、Firebase Web Appの設定値を入力してください。

```bash
cp .env.example .env.local
```

必要項目：
- NEXT_PUBLIC_FIREBASE_API_KEY
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
- NEXT_PUBLIC_FIREBASE_PROJECT_ID
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- NEXT_PUBLIC_FIREBASE_APP_ID

## Firestore collections
- `events`: 予定本体
- `reservations`: 会議室・社用車予約
- `feedbacks`: 改善提案・不具合報告
- `notifications`: メール／Teams送信キュー

## 次の実装
1. PJ-020のTeams通知方式移植
2. メール実送信処理
3. Firebase Authentication
4. 設備予約専用画面
5. 管理画面・社員／部署／設備マスタ
6. 予定編集・取消


## Teams通知
PJ-020の既存運用を継承し、来客を伴う会議室予約では通知文を自動コピーして指定Teamsチャットを開きます。

Teams通知先は公開リポジトリへ直書きせず、Vercel / ローカル環境変数 `NEXT_PUBLIC_TEAMS_MEETING_CHAT_URL` に設定してください。
