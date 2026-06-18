// ====================================================================
// 若松町町内会ポータル – サービス設定ファイル
//
// ここを変更するだけで Google 各サービスとの連携先を一元管理できます。
// ホームページ本体のコードは変更不要です。
// ====================================================================

import { RUNTIME_CONFIG } from "./runtime-config.js?v=20260618";

export const SITE_CONFIG = {

    // ------------------------------------------------------------------
    // Google Calendar
    // mainUrl : メインカレンダーの埋め込みURL（1枚表示）
    // embeds  : カテゴリ別の補助カレンダーURL一覧
    // 設定方法: Google Calendar > カレンダーを共有 > 埋め込みコード の src= 部分
    // ------------------------------------------------------------------
    calendar: {
        apiKey: RUNTIME_CONFIG.GOOGLE_CALENDAR_API_KEY,
        calendarId: RUNTIME_CONFIG.GOOGLE_CALENDAR_ID,
        mainUrl: "https://calendar.google.com/calendar/embed?src=sample-main%40example.com&ctz=Asia%2FTokyo&mode=MONTH",
        learningUrl: "https://calendar.google.com/calendar/embed?src=sample-learning%40example.com&ctz=Asia%2FTokyo&mode=AGENDA",
        management: {
            eventsSheetUrl: "https://docs.google.com/spreadsheets/d/sample-events-sheet-id/gviz/tq?tqx=out:json",
            eventsEditUrl: "https://docs.google.com/spreadsheets/d/sample-events-sheet-id/edit#gid=0",
            submitEndpoint: "https://script.google.com/macros/s/sample-events-script-id/exec",
            recruitSubmitEndpoint: "https://script.google.com/macros/s/sample-recruit-script-id/exec",
            attendanceSubmitEndpoint: "https://script.google.com/macros/s/sample-attendance-script-id/exec"
        },
        mockManagedEvents: [
            {
                id: "EV-001",
                type: "recurring",
                title: "月例清掃",
                category: "清掃",
                scheduleLabel: "毎月第1日曜 8:00",
                place: "若松町内全域",
                description: "町内清掃活動",
                recruitFormUrl: "https://forms.gle/sample-cleanup-recruit"
            },
            {
                id: "EV-002",
                type: "special",
                title: "コミニティ 6月講座",
                category: "コミニティ",
                scheduleLabel: "2026-07-12 10:00",
                place: "若松集会所",
                description: "防災をテーマにしたコミニティ講座です。初参加の方も歓迎します。",
                recruitFormUrl: "https://forms.gle/sample-seminar-recruit"
            },
            {
                id: "EV-003",
                type: "special",
                title: "コミニティ 7月講座",
                category: "コミニティ",
                scheduleLabel: "2026-07-26 10:00",
                place: "若松集会所",
                description: "地域交流と防災知識を学ぶコミニティ講座です。",
                recruitFormUrl: "https://forms.gle/sample-seminar-recruit"
            }
        ]
    },

    // ------------------------------------------------------------------
    // Google Forms
    // 設定方法: Googleフォーム > 送信 > リンクアイコン からURLをコピー
    // ------------------------------------------------------------------
    forms: {
        contact: "https://forms.gle/contact-sample",
        equipment: {
            tent:      "https://forms.gle/equipment-tent",
            table:     "https://forms.gle/equipment-table",
            chair:     "https://forms.gle/equipment-chair",
            generator: "https://forms.gle/equipment-generator",
            mower:     "https://forms.gle/equipment-mower"
        }
    },

    // ------------------------------------------------------------------
    // 備品予約（スマホ優先UI向け）
    // items            : ドロップダウンおよびあいまい検索対象
    // timelineDays     : ガント表示の日数
    // mockReservations : 予約モック（初回のみローカル保存へ取り込み）
    // ------------------------------------------------------------------
    equipment: {
        timelineDays: 14,
        sheets: {
            // 備品マスター管理用シート（id, label, stock, aliases）
            masterSheetUrl: "https://docs.google.com/spreadsheets/d/sample-equipment-master-sheet-id/gviz/tq?tqx=out:json",
            masterEditUrl: "https://docs.google.com/spreadsheets/d/sample-equipment-master-sheet-id/edit#gid=0",

            // 予約台帳管理用シート（1行=1備品予約）
            reservationSheetUrl: "https://docs.google.com/spreadsheets/d/sample-equipment-reservation-sheet-id/gviz/tq?tqx=out:json",
            reservationEditUrl: "https://docs.google.com/spreadsheets/d/sample-equipment-reservation-sheet-id/edit#gid=0",

            // フロントから予約を書き込むApps Script WebアプリURL
            submitEndpoint: "https://script.google.com/macros/s/sample-script-id/exec"
        },
        items: [
            { id: "tent", label: "テント", stock: 3, aliases: ["てんと", "大型テント", "イベント"] },
            { id: "table", label: "長机", stock: 10, aliases: ["机", "つくえ", "会議机"] },
            { id: "chair", label: "椅子", stock: 30, aliases: ["いす", "パイプ椅子"] },
            { id: "generator", label: "発電機", stock: 2, aliases: ["はつでんき", "電源"] },
            { id: "mower", label: "草刈機", stock: 2, aliases: ["くさかり", "草刈り機"] }
        ],
        mockReservations: [
            {
                id: "R-1001",
                equipmentId: "tent",
                equipmentLabel: "テント",
                name: "田中一郎",
                phone: "090-1111-2222",
                group: "1組2班",
                loanDate: "2026-06-08",
                returnDate: "2026-06-10",
                createdAt: "2026-06-01T09:00:00.000Z"
            },
            {
                id: "R-1002",
                equipmentId: "generator",
                equipmentLabel: "発電機",
                name: "佐藤花子",
                phone: "090-3333-4444",
                group: "3組1班",
                loanDate: "2026-06-12",
                returnDate: "2026-06-13",
                createdAt: "2026-06-02T11:30:00.000Z"
            }
        ]
    },

    // ------------------------------------------------------------------
    // Google Drive
    // circularFolderId : 回覧板フォルダのID（URL末尾の長い文字列）
    // mockCircular     : 本番前のモックデータ（年別フォルダ構成）
    //
    // 将来の Drive API 連携時は drive.js の getDriveCircular() を書き換えます。
    // ------------------------------------------------------------------
    drive: {
        circularFolderId:  "sample-circular-folder-id",
        circularFolderUrl: "https://drive.google.com/drive/folders/sample-circular-folder-id",
        documentsFolderUrl: "https://drive.google.com/drive/folders/sample-documents-folder-id",
        disasterManualUrl: "https://drive.google.com/file/d/sample-manual/view",
        uploadEndpoint: "https://script.google.com/macros/s/sample-drive-doc-upload-script-id/exec",

        // 回覧板（年別フォルダ想定）
        mockCircular: {
            "2026": [
                { title: "回覧板 2026年6月号", url: "#", date: "2026-06-01" },
                { title: "回覧板 2026年5月号", url: "#", date: "2026-05-01" },
                { title: "回覧板 2026年4月号", url: "#", date: "2026-04-01" }
            ],
            "2027": [],
            "2028": []
        },

        // その他資料（総会資料・会則など）
        mockDocuments: {
            "総会資料": [
                { title: "2026年度 定期総会資料", url: "#" }
            ],
            "会則": [
                { title: "若松町内会 会則（令和8年度版）", url: "#" }
            ],
            "議事録": [
                { title: "役員会議事録 2026-05-20", url: "#" }
            ],
            "防災資料": [
                { title: "防災ハンドブック", url: "#" }
            ]
        }
    },

    // ------------------------------------------------------------------
    // Google Sheets（ゴミ収集スケジュール）
    // 将来: スプレッドシートを公開して sheetUrl から JSON 取得
    // 現在: mockSchedule を使用
    //
    // スプレッドシート想定構造:
    //   列A: dayIndex (0=日 1=月 … 6=土)
    //   列B: label    (月曜日 など表示用)
    //   列C: types    (燃えるゴミ,資源ゴミ  ← カンマ区切り)
    // ------------------------------------------------------------------
    trash: {
        sheetId:  "sample-sheet-id",
        sheetUrl: "https://docs.google.com/spreadsheets/d/sample-sheet-id/gviz/tq?tqx=out:json",
        mockSchedule: [
            { dayIndex: 1, label: "月曜日", types: ["燃えるゴミ"] },
            { dayIndex: 4, label: "木曜日", types: ["燃えるゴミ"] },
            { dayIndex: 5, label: "金曜日", types: ["資源ゴミ"] }
        ]
    },

    // ------------------------------------------------------------------
    // Google My Maps（地域マップ）
    // myMapsUrl: マイマップの埋め込みURL
    // spots    : 地図上のスポット（カテゴリ別）
    //
    // 設定方法: マイマップ > 共有 > 地図を埋め込む の src= 部分
    // ------------------------------------------------------------------
    map: {
        myMapsUrl: "https://www.google.com/maps/d/u/0/embed?mid=sample-map-id",
        localImageUrl: "素材/若松町ない「お散歩マップ」.png",
        spots: [
            { name: "若松集会所",             category: "集会所", x: 58, y: 43 },
            { name: "若松小学校（第1避難所）", category: "避難所", x: 28, y: 22 },
            { name: "若松中央公園（第2避難所）",category: "避難所", x: 77, y: 57 },
            { name: "AED設置場所（集会所内）", category: "AED", x: 50, y: 29 },
            { name: "若松防災倉庫",            category: "防災倉庫", x: 66, y: 34 }
        ]
    },

    // ------------------------------------------------------------------
    // 写真アルバム（Google Drive フォルダ連携想定）
    // driveFolderId: 各アルバムのフォルダID
    // mockPhotos   : 本番前のモックデータ
    // ------------------------------------------------------------------
    gallery: {
        drive: {
            rootFolderId: "sample-gallery-root-folder-id",
            createFolderEndpoint: "https://script.google.com/macros/s/sample-gallery-folder-script-id/exec",
            listPhotosEndpoint: "https://script.google.com/macros/s/sample-gallery-list-script-id/exec",
            uploadEndpoint: "https://script.google.com/macros/s/sample-gallery-upload-script-id/exec"
        },
        destinations: [
            { id: "community-rose", label: "コミュニティ_バラ園管理", folderId: "sample-community-rose-folder-id" },
            { id: "community-general", label: "コミュニティ_区分なし", folderId: "sample-community-general-folder-id" },
            { id: "archive", label: "アーカイブ", folderId: "sample-archive-folder-id" }
        ],
        albums: [
            {
                title: "バラ園管理",
                year: "2026",
                coverEmoji: "🌹",
                description: "コミュニティ活動（バラ園管理）の記録です。",
                driveFolderId: "sample-community-rose-folder-id",
                mockPhotos: [
                    { title: "花壇整備" },
                    { title: "剪定作業" },
                    { title: "水やり" }
                ]
            },
            {
                title: "区分なし",
                year: "2026",
                coverEmoji: "📷",
                description: "コミュニティ活動（区分なし）の写真です。",
                driveFolderId: "sample-community-general-folder-id",
                mockPhotos: [
                    { title: "活動風景1" },
                    { title: "活動風景2" }
                ]
            },
            {
                title: "アーカイブ",
                year: "2026",
                coverEmoji: "🗂️",
                description: "過去写真の保管用アルバムです。",
                driveFolderId: "sample-archive-folder-id",
                mockPhotos: [
                    { title: "過去活動記録" }
                ]
            }
        ]
    },

    emergency: {
        message: "現在、緊急のお知らせはありません。"
    },

    gas: {
        webAppUrl: RUNTIME_CONFIG.GAS_WEB_APP_URL
    },

    adminData: {
        people: {
            sheetUrl: "https://docs.google.com/spreadsheets/d/sample-people-sheet-id/gviz/tq?tqx=out:json",
            editUrl: "https://docs.google.com/spreadsheets/d/sample-people-sheet-id/edit#gid=0",
            submitEndpoint: "https://script.google.com/macros/s/sample-people-script-id/exec",
            mock: [
                { name: "山田太郎", phone: "090-1234-5678", group: "1組1班", memo: "防災担当" }
            ]
        },
        equipmentLedger: {
            sheetUrl: "https://docs.google.com/spreadsheets/d/sample-ledger-sheet-id/gviz/tq?tqx=out:json",
            editUrl: "https://docs.google.com/spreadsheets/d/sample-ledger-sheet-id/edit#gid=0",
            submitEndpoint: "https://script.google.com/macros/s/sample-ledger-script-id/exec",
            mock: [
                { equipmentName: "テント", stock: 3, location: "防災倉庫", memo: "点検済み" }
            ]
        }
    },

    // ------------------------------------------------------------------
    // 将来拡張フラグ（機能追加時に true へ変更）
    // ------------------------------------------------------------------
    integrations: {
        lineNotify:             false,
        driveApiReady:          true,
        calendarApiReady:       true,
        formsApiReady:          true,
        sheetsApiReady:         true,
        memberManagementReady:  false,
        aiChatbotReady:         false,
        disasterAlertReady:     false,
        googleLoginReady:       false
    }
};
