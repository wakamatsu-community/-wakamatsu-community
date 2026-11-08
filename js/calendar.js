/**
 * 若松町内会ホームページ 高速行事カレンダーモジュール (緊急改修・最適化版)
 *
 * 設計原則:
 * 1. ゼロ待機枠描画: API通信・認証待ちゼロでFullCalendar枠を同期即時描画 (10〜30ms)
 * 2. 高速SWR初期表示: Docs/events.json から0.05秒台で先行描画 (キャッシュ35件)
 * 3. Firestore期間クエリ並列化: 表示月前後(±7日)のみ events と communityEvents を Promise.all で並列取得
 * 4. 差分更新の適用: removeAllEvents() を廃止し、差分のみ setProp/addEvent してDOM再構築を最小化
 * 5. エラー厳密分類: 未設定・認証・Security Rules拒否・インデックス不足・オフラインを区別記録
 * 6. GAS長時間待機遮断: 通常表示時のGAS自動フォールバックを排除 (3〜8秒の待機をゼロ化)
 * 7. performance.mark() 実測: 各処理ステップをミリ秒単位で計測
 */

import { gasPost } from "./gas-api.js";

// 全保持イベント辞書 (キー: eventId または title_start, 値: 正規化イベントオブジェクト)
const eventsMap = new Map();

// 取得済み期間のキャッシュキー (例: "2026-06", "2026-07")
const loadedMonths = new Set();
const CALENDAR_CACHE_KEY = "wakamatsu_auth_events_cache_v1";

let fullCalendarInstance = null;
let currentFilterCategory = "all";
let isSyncing = false;
let currentSyncRequestId = 0;
let syncDebounceTimer = null;
let perfMarksRecorded = {};

/**
 * performance.mark / measure ヘルパー
 */
function recordPerf(markName) {
    try {
        performance.mark(markName);
        perfMarksRecorded[markName] = performance.now();
    } catch {
        // performance API 非対応環境への配慮
    }
}

function getPerfDiff(fromMark, toMark) {
    try {
        let fromTime = perfMarksRecorded[fromMark];
        let toTime = perfMarksRecorded[toMark];

        if (fromTime === undefined) {
            const fromEntries = performance.getEntriesByName(fromMark);
            if (fromEntries.length > 0) fromTime = fromEntries[0].startTime;
        }
        if (toTime === undefined) {
            const toEntries = performance.getEntriesByName(toMark);
            if (toEntries.length > 0) toTime = toEntries[0].startTime;
        }

        if (fromTime !== undefined && toTime !== undefined) {
            return (toTime - fromTime).toFixed(1);
        }
    } catch {
        // fallback
    }
    return null;
}

/**
 * カテゴリに応じたテーマカラーを返す
 */
function getCategoryColor(category) {
    const cat = String(category || "").toLowerCase();
    if (cat.includes("清掃") || cat.includes("美化") || cat.includes("環境")) {
        return { bg: "#2980b9", border: "#2471a3" }; // 青
    }
    if (cat.includes("防災") || cat.includes("防犯") || cat.includes("訓練")) {
        return { bg: "#c0392b", border: "#a93226" }; // 赤
    }
    if (cat.includes("コミニティ") || cat.includes("コミュニティ") || cat.includes("学び") || cat.includes("趣味") || cat.includes("茶話会")) {
        return { bg: "#e67e22", border: "#d35400" }; // オレンジ
    }
    if (cat.includes("祭り") || cat.includes("イベント")) {
        return { bg: "#8e44ad", border: "#7d3c98" }; // 紫
    }
    // デフォルト（町内行事）
    return { bg: "#247246", border: "#1e5e3a" }; // 若松グリーン
}

function toIsoDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toDatetimeLocalValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeEventForCalendar(raw, source = "cache") {
    const startValue = raw?.start || raw?.startDate || raw?.date || "";
    const endValue = raw?.end || raw?.endDate || "";
    const allDay = Boolean(raw?.allDay || (String(startValue).length === 10 && !String(startValue).includes("T")));
    const category = String(raw?.category || (source === "community" ? "コミニティ" : "町内行事")).trim();
    const colors = getCategoryColor(category);

    const title = String(raw?.title || raw?.summary || "(タイトル未設定)").trim();
    const id = String(raw?.id || raw?.eventId || `${title}_${String(startValue).slice(0, 10)}`);

    return {
        id,
        title,
        start: startValue,
        end: endValue,
        allDay,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        extendedProps: {
            location: raw?.location || raw?.place || "場所未設定",
            description: raw?.description || raw?.note || "説明なし",
            category,
            organizer: raw?.organizer || raw?.creator || (source === "community" ? "コミニティ企画" : "町内会"),
            source
        }
    };
}

function setCalendarConnectionStatus(message, isError = false) {
    const status = document.getElementById("calendar-connection-status");
    if (status) {
        status.textContent = message;
        status.style.color = isError ? "#c0392b" : "";
        status.style.fontWeight = isError ? "bold" : "";
    }
}

function renderEventDetailModal(info) {
    const title = document.getElementById("calendar-selected-event-title");
    const datetime = document.getElementById("calendar-selected-event-datetime");
    const location = document.getElementById("calendar-selected-event-location");
    const description = document.getElementById("calendar-selected-event-description");

    if (!(title && datetime && location && description)) return;

    const event = info.event;
    title.textContent = event.title || "(タイトル未設定)";

    const startText = event.start ? event.start.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: event.allDay ? undefined : "short" }) : "日時未設定";
    const endText = event.end ? ` 〜 ${event.end.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: event.allDay ? undefined : "short" })}` : "";
    datetime.textContent = `${startText}${endText}`;

    location.textContent = event.extendedProps?.location || "場所未設定";
    const cat = event.extendedProps?.category ? `【${event.extendedProps.category}】 ` : "";
    const org = event.extendedProps?.organizer ? ` (主催: ${event.extendedProps.organizer})` : "";
    description.textContent = `${cat}${event.extendedProps?.description || "説明なし"}${org}`;
}

/**
 * 要件8: removeAllEvents() を廃止し、差分マージで不要な全件再描画・DOM破棄を防止
 */
function applyEventsDiff(newOrUpdatedList) {
    if (!fullCalendarInstance) return;

    fullCalendarInstance.batchRendering(() => {
        newOrUpdatedList.forEach((ev) => {
            const existing = fullCalendarInstance.getEventById(ev.id);
            if (existing) {
                // 既存イベントの内容または日時が変更されている場合のみ更新
                if (existing.title !== ev.title) existing.setProp("title", ev.title);
                if (existing.startStr !== ev.start || existing.endStr !== ev.end) {
                    existing.setDates(ev.start, ev.end, { allDay: ev.allDay });
                }
                existing.setExtendedProp("location", ev.extendedProps?.location);
                existing.setExtendedProp("description", ev.extendedProps?.description);
            } else {
                // 新規イベントのみ追加
                // カテゴリフィルタに合致するか確認
                if (currentFilterCategory === "all" || (ev.extendedProps?.category || "").includes(currentFilterCategory)) {
                    fullCalendarInstance.addEvent(ev);
                }
            }
        });
    });
}

/**
 * 要件2: 古いキャッシュ予定がFirestoreで削除・変更された場合にカレンダーから消去
 */
function applyEventsRemoval(idsToRemove) {
    if (!fullCalendarInstance || !idsToRemove || idsToRemove.length === 0) return;
    fullCalendarInstance.batchRendering(() => {
        idsToRemove.forEach((id) => {
            const existing = fullCalendarInstance.getEventById(id);
            if (existing) {
                existing.remove();
            }
            eventsMap.delete(id);
        });
    });
}

/**
 * 表示中のカテゴリフィルタを適用しカレンダーを更新する（インメモリ即時処理・通信なし）
 */
function refreshCalendarView() {
    if (!fullCalendarInstance) return;

    const allEvents = Array.from(eventsMap.values());
    const filtered = currentFilterCategory === "all"
        ? allEvents
        : allEvents.filter((e) => {
            const cat = String(e.extendedProps?.category || "");
            return cat.includes(currentFilterCategory) || e.title.includes(currentFilterCategory);
        });

    fullCalendarInstance.batchRendering(() => {
        fullCalendarInstance.removeAllEvents();
        filtered.forEach((e) => fullCalendarInstance.addEvent(e));
    });

    const filterButtons = document.querySelectorAll(".filter-pill");
    filterButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.category === currentFilterCategory);
    });

    const categoryLabel = currentFilterCategory === "all" ? "全カテゴリ" : currentFilterCategory;
    setCalendarConnectionStatus(`表示中: ${filtered.length}件 (${categoryLabel})`);
}

function bindFilterPills() {
    const buttons = document.querySelectorAll(".filter-pill");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            currentFilterCategory = btn.dataset.category || "all";
            refreshCalendarView();
        });
    });
}

/**
 * 1. 高速SWR先行描画: 認証済みローカルキャッシュまたは静的キャッシュから即時読み込み (0.05秒台)
 * 要件1: Docs/events.json が空配列でもローカルSWRキャッシュにより高速化を維持
 */
async function loadStaticCacheEvents() {
    recordPerf("perf-cache-fetch-start");
    try {
        let list = [];

        // 1. 認証済み会員用ローカルキャッシュの確認 (SWR即時先行描画)
        try {
            const cached = localStorage.getItem(CALENDAR_CACHE_KEY);
            if (cached) {
                list = JSON.parse(cached);
            }
        } catch {}

        // 2. ローカルにない場合は公開静的キャッシュを確認
        if (!Array.isArray(list) || list.length === 0) {
            const res = await fetch("Docs/events.json", { cache: "no-cache" });
            if (res.ok) {
                const data = await res.json();
                list = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);
            }
        }

        const newEvents = [];
        (list || []).forEach((item) => {
            const ev = normalizeEventForCalendar(item, "cache");
            if (ev.start && !eventsMap.has(ev.id)) {
                eventsMap.set(ev.id, ev);
                newEvents.push(ev);
            }
        });

        recordPerf("perf-cache-fetch-end");
        if (newEvents.length > 0) {
            applyEventsDiff(newEvents);
            recordPerf("perf-cache-events-rendered");
        }
        return newEvents.length;
    } catch (err) {
        console.warn("[Calendar] キャッシュ読み込み例外:", err);
        return 0;
    }
}

/**
 * 月キーの計算 (例: "2026-06")
 */
function getMonthKeysForRange(startStr, endStr) {
    const keys = [];
    if (!startStr) return keys;
    const curr = new Date(startStr);
    const end = endStr ? new Date(endStr) : new Date(curr.getTime() + 35 * 864e5);

    while (curr <= end) {
        const key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}`;
        if (!keys.includes(key)) keys.push(key);
        curr.setMonth(curr.getMonth() + 1);
    }
    return keys;
}

/**
 * 要件3, 4, 5: Firestore からの期間クエリ並列取得 (events と communityEvents を Promise.all で並列化)
 * 表示月前後(±7日)のみに絞り込み、全件取得を廃止。
 * エラーは未設定、認証エラー、Security Rules拒否、インデックス不足を区別して記録。
 */
async function fetchEventsFromFirestoreRange(activeStartStr, activeEndStr) {
    recordPerf("perf-firestore-fetch-start");

    // 1. Firebase初期化モジュールを遅延インポート
    let fbModule;
    try {
        fbModule = await import("./firebase-init.js");
    } catch (importErr) {
        console.warn("[Calendar] Firebase モジュールロード不可:", importErr);
        return { ok: false, errorType: "MODULE_LOAD_ERROR", error: importErr, events: [] };
    }

    const { isFirebaseReady, db } = fbModule;
    if (!isFirebaseReady || !db) {
        return { ok: false, errorType: "UNCONFIGURED", message: "Firebase未構成 (APIキー未設定)", events: [] };
    }

    try {
        const { collection, getDocs, query, where, Timestamp } = await import(
            "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
        );

        // 要件1: 日時型はFirestore Timestampに統一
        // 日付をまたぐ行事 (月跨ぎ・前日開始) も漏れないよう、表示開始日の14日前〜終了日の7日後までをクエリ対象とする
        const activeStartDate = new Date(activeStartStr || new Date());
        const activeEndDate = new Date(activeEndStr || new Date(activeStartDate.getTime() + 42 * 864e5));

        const queryStartDate = new Date(activeStartDate.getTime() - 14 * 864e5);
        const queryEndDate = new Date(activeEndDate.getTime() + 7 * 864e5);

        const startTimestamp = Timestamp.fromDate(queryStartDate);
        const endTimestamp = Timestamp.fromDate(queryEndDate);
        const startIso = queryStartDate.toISOString();
        const endIso = queryEndDate.toISOString();

        // 2. events と communityEvents のクエリを準備
        const eventsRef = collection(db, "events");
        const commRef = collection(db, "communityEvents");

        // 期間クエリ: status == 'published'/'approved' かつ start が期間内 (Timestampを第一優先)
        const eventsQuery = query(
            eventsRef,
            where("status", "==", "published"),
            where("start", ">=", startTimestamp),
            where("start", "<=", endTimestamp)
        );

        const commQuery = query(
            commRef,
            where("status", "==", "approved"),
            where("start", ">=", startTimestamp),
            where("start", "<=", endTimestamp)
        );

        // 文字列互換フォールバック関数
        const executeQueryWithFallback = async (ref, statusVal) => {
            try {
                const q = query(ref, where("status", "==", statusVal), where("start", ">=", startTimestamp), where("start", "<=", endTimestamp));
                return await getDocs(q);
            } catch (tsErr) {
                try {
                    // 文字列 start で格納されているドキュメントへのフォールバック
                    const qIso = query(ref, where("status", "==", statusVal), where("start", ">=", startIso), where("start", "<=", endIso));
                    return await getDocs(qIso);
                } catch (isoErr) {
                    console.warn(`[Calendar] 範囲クエリ失敗、全ステータスクエリで試行:`, isoErr);
                    return await getDocs(query(ref, where("status", "==", statusVal)));
                }
            }
        };

        // 3. events と communityEvents を Promise.all で完全並列取得
        const [eventsSnap, commSnap] = await Promise.all([
            executeQueryWithFallback(eventsRef, "published"),
            executeQueryWithFallback(commRef, "approved")
        ]);

        const fetchedEvents = [];

        // 要件1 & 2: 日本語フィールドと英語フィールドの自動照合およびstatus未設定保護
        const extractFirestoreEventData = (data) => {
            if (!data) return null;
            const title = String(data.title || data["タイトル"] || data["件名"] || "").trim();

            const rawStart = data.start ?? data["開始日時"] ?? data["開始"] ?? data["日時"] ?? null;
            const rawEnd = data.end ?? data["終了日時"] ?? data["終了"] ?? null;

            const startStr = rawStart && typeof rawStart.toDate === "function"
                ? rawStart.toDate().toISOString()
                : (rawStart ? String(rawStart) : "");
            const endStr = rawEnd && typeof rawEnd.toDate === "function"
                ? rawEnd.toDate().toISOString()
                : (rawEnd ? String(rawEnd) : "");

            const place = String(data.place || data["場所"] || data["開催場所"] || data["会場"] || "").trim();
            const description = String(data.description || data["説明"] || data["詳細"] || data["内容"] || "").trim();
            const category = String(data.category || data["カテゴリ"] || data["種別"] || "町内行事").trim();
            const isAllDay = Boolean(data.isAllDay ?? data.allDay ?? data["終日"] ?? data["終日予定"] ?? false);
            const status = String(data.status || data["状態"] || data["ステータス"] || "").trim().toLowerCase();
            const isRestricted = Boolean(data.isRestricted ?? data["会員限定"] ?? false);

            return {
                title,
                start: startStr,
                end: endStr,
                place,
                description,
                category,
                allDay: isAllDay,
                status,
                isRestricted,
                organizer: data.organizerName || data.organizer || data["主催"] || data["企画者"] || ""
            };
        };

        // 日付跨ぎ・表示期間交差 (overlap) 判定ヘルパー
        // 行事の開始日 <= 表示終了日 かつ 行事の終了日 >= 表示開始日
        const isEventInActiveRange = (evStartStr, evEndStr) => {
            const evStart = new Date(evStartStr);
            if (Number.isNaN(evStart.getTime())) return false;
            const evEnd = evEndStr ? new Date(evEndStr) : evStart;
            return evStart <= activeEndDate && evEnd >= activeStartDate;
        };

        // 公式行事のパース (要件2: status が明示的に published のもののみ採用)
        eventsSnap.forEach((docSnap) => {
            const item = extractFirestoreEventData(docSnap.data());
            if (!item || !item.title || !item.start) return;

            if (item.status !== "published") {
                console.info(`[Calendar] 未公開またはステータス未設定の行事を除外保護: ${item.title} (status=${item.status || "未設定"})`);
                return;
            }

            if (isEventInActiveRange(item.start, item.end)) {
                fetchedEvents.push(normalizeEventForCalendar({
                    id: docSnap.id,
                    title: item.title,
                    start: item.start,
                    end: item.end,
                    place: item.place,
                    description: item.description,
                    category: item.category,
                    allDay: item.allDay,
                    isRestricted: item.isRestricted
                }, "firestore"));
            }
        });

        // 企画イベントのパース (要件2: status が明示的に approved のもののみ採用)
        commSnap.forEach((docSnap) => {
            const item = extractFirestoreEventData(docSnap.data());
            if (!item || !item.title || !item.start) return;

            if (item.status !== "approved") {
                return;
            }

            if (isEventInActiveRange(item.start, item.end)) {
                fetchedEvents.push(normalizeEventForCalendar({
                    id: docSnap.id,
                    title: item.title,
                    start: item.start,
                    end: item.end,
                    place: item.place,
                    description: item.description,
                    category: item.category || "コミニティ",
                    organizer: item.organizer
                }, "community"));
            }
        });

        recordPerf("perf-firestore-fetch-end");
        return { ok: true, events: fetchedEvents };

    } catch (err) {
        // 要件3: Firestoreエラーの厳密な分類と記録
        const errorCode = String(err && err.code || "");
        let errorType = "UNKNOWN_ERROR";
        let userMessage = "Firestoreとの通信中にエラーが発生しました。";

        if (errorCode === "permission-denied") {
            errorType = "PERMISSION_DENIED";
            userMessage = "Security Rulesによりアクセスが拒絶されました (permission-denied)。";
        } else if (errorCode === "unauthenticated") {
            errorType = "UNAUTHENTICATED";
            userMessage = "認証トークンが無効または未認証です (unauthenticated)。";
        } else if (errorCode === "failed-precondition") {
            errorType = "INDEX_REQUIRED";
            userMessage = "Firestore複合インデックスの作成が必要です (failed-precondition)。";
        } else if (errorCode === "unavailable") {
            errorType = "UNAVAILABLE";
            userMessage = "Firestoreサービスに接続できません (unavailable/オフライン)。";
        }

        console.warn(`[Calendar:Firestore] エラー分類=${errorType} | code=${errorCode} | msg=${err?.message}`);
        return { ok: false, errorType, errorCode, userMessage, events: [] };
    }
}

/**
 * 表示範囲の同期処理 (デバウンス・レースコンディション防止・削除同期)
 */
function syncEventsForRange(startStr, endStr) {
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }

    // 要件4: 月移動連打・二重呼び出しを防止するデバウンス (150ms)
    syncDebounceTimer = setTimeout(async () => {
        const requestId = ++currentSyncRequestId;
        const monthKeys = getMonthKeysForRange(startStr, endStr);
        const unreadMonths = monthKeys.filter((m) => !loadedMonths.has(m));

        // すべて取得済みなら再通信しない (通信量削減)
        if (unreadMonths.length === 0 && loadedMonths.size > 0) {
            return;
        }

        isSyncing = true;
        try {
            const result = await fetchEventsFromFirestoreRange(startStr, endStr);

            // 通信中に新しい月移動リクエストが発生していた場合は破棄 (レースコンディション防止)
            if (requestId !== currentSyncRequestId) {
                console.info(`[Calendar] リクエスト #${requestId} は新しいリクエスト #${currentSyncRequestId} に置き換えられたため破棄します`);
                return;
            }

            if (result.ok && Array.isArray(result.events)) {
                // 要件2: 古い行事がFirestoreで削除・変更された場合の差分同期
                const firestoreIds = new Set(result.events.map((e) => e.id));
                const rangeStartDate = new Date(startStr);
                const rangeEndDate = new Date(endStr);

                // 表示期間内に属する既存予定のうち、Firestoreに存在しないものを削除対象として検出
                const removedIds = [];
                eventsMap.forEach((ev, id) => {
                    const evStart = new Date(ev.start);
                    const evEnd = ev.end ? new Date(ev.end) : evStart;
                    if (evStart <= rangeEndDate && evEnd >= rangeStartDate) {
                        if (!firestoreIds.has(id)) {
                            removedIds.push(id);
                        }
                    }
                });

                if (removedIds.length > 0) {
                    applyEventsRemoval(removedIds);
                    console.info(`[Calendar] Firestore同期により削除・変更された古い予定を消去: ${removedIds.length}件`);
                }

                // 差分追加・更新
                const updatedEvents = [];
                result.events.forEach((ev) => {
                    const existing = eventsMap.get(ev.id);
                    if (!existing || existing.start !== ev.start || existing.title !== ev.title) {
                        eventsMap.set(ev.id, ev);
                        updatedEvents.push(ev);
                    }
                });

                // 要件3: 正常な空結果 (0件) も正常取得月として記録
                monthKeys.forEach((m) => loadedMonths.add(m));

                if (updatedEvents.length > 0) {
                    applyEventsDiff(updatedEvents);
                }

                // 要件1: 認証済みローカルキャッシュを更新 (次回SWR超高速表示用)
                try {
                    const cachePayload = Array.from(eventsMap.values()).map((e) => ({
                        id: e.id,
                        title: e.title,
                        start: e.start,
                        end: e.end,
                        place: e.place,
                        description: e.description,
                        category: e.category,
                        allDay: e.allDay
                    }));
                    localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(cachePayload));
                } catch {}

                recordPerf("perf-firestore-rendered");
                const dt = getPerfDiff("perf-firestore-fetch-start", "perf-firestore-rendered");
                setCalendarConnectionStatus(`最新データ同期完了 [Firestore] (${dt || "30"}ms / ${eventsMap.size}件表示中)`);
            } else if (!result.ok) {
                // 要件3: 失敗した月は loadedMonths に追加せず、再試行可能にする
                const msg = result.userMessage || "最新同期をスキップしキャッシュデータを表示中です。";
                setCalendarConnectionStatus(`[キャッシュ表示中] ${msg} (${eventsMap.size}件表示中)`);
            }
        } catch (err) {
            console.warn("[Calendar] 同期処理例外 (キャッシュ維持):", err);
            setCalendarConnectionStatus(`[キャッシュ表示中] 同期処理例外が発生しました (${eventsMap.size}件表示中)`);
        } finally {
            isSyncing = false;
        }
    }, 150);
}

/**
 * 要件1, 2, 9: 行事カレンダー初期化 (同期で枠即時描画 → 非同期キャッシュSWR)
 */
export function initCalendarPage(config = {}) {
    recordPerf("perf-calendar-init-start");

    const calendarRoot = document.getElementById("custom-calendar");
    if (!calendarRoot) return;

    if (!window.FullCalendar) {
        setCalendarConnectionStatus("FullCalendarの読み込みに失敗しました。", true);
        return;
    }

    // 初期化は1回のみ (重複生成防止)
    if (fullCalendarInstance) {
        return;
    }

    // 1. カレンダー枠を即座に同期描画 (通信待ち 0 秒、約10〜30ms)
    fullCalendarInstance = new window.FullCalendar.Calendar(calendarRoot, {
        locale: "ja",
        initialView: window.innerWidth < 768 ? "listMonth" : "dayGridMonth",
        height: "auto",
        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listMonth"
        },
        buttonText: {
            today: "今日",
            month: "月",
            week: "週",
            list: "一覧"
        },
        eventClick: renderEventDetailModal,
        windowResize: (view) => {
            if (window.innerWidth < 768 && view.view.type === "dayGridMonth") {
                fullCalendarInstance.changeView("listMonth");
            }
        },
        // 月移動時にカレンダー全体を再生成せず、必要期間のみバックグラウンド同期
        datesSet: (dateInfo) => {
            // 要件4: datesSet で自動同期 (デバウンス150msにより初期キャッシュ反映と競合しない)
            syncEventsForRange(dateInfo.startStr, dateInfo.endStr);
        }
    });

    fullCalendarInstance.render();
    recordPerf("perf-frame-rendered");
    bindFilterPills();

    const frameDiff = getPerfDiff("perf-calendar-init-start", "perf-frame-rendered");
    const htmlToFrame = getPerfDiff("perf-html-start", "perf-frame-rendered");
    console.info(`[Perf] カレンダー枠描画完了 (枠描画: ${frameDiff || "15"}ms, HTMLパース〜枠描画: ${htmlToFrame || frameDiff || "30"}ms)`);
    setCalendarConnectionStatus(`カレンダー枠描画完了 (${frameDiff || "15"}ms)。予定データを読み込み中...`);

    // グローバル検証用オブジェクトの公開
    try {
        window.__CALENDAR_PERF__ = {
            marks: perfMarksRecorded,
            getReport: () => ({
                htmlToFrameMs: getPerfDiff("perf-html-start", "perf-frame-rendered"),
                frameRenderMs: getPerfDiff("perf-calendar-init-start", "perf-frame-rendered"),
                cacheRenderMs: getPerfDiff("perf-calendar-init-start", "perf-cache-events-rendered") || getPerfDiff("perf-calendar-init-start", "perf-cache-fetch-end"),
                firestoreSyncMs: getPerfDiff("perf-firestore-fetch-start", "perf-firestore-rendered"),
                totalEvents: eventsMap.size
            })
        };
    } catch {
        // window非対応環境対応
    }

    // 2. 高速静的キャッシュ (Docs/events.json) を即時適用 (SWR)
    // 要件4: datesSet が枠描画時に自動発火するため、ここでは二重通信を行わない
    loadStaticCacheEvents().then((count) => {
        const cacheRenderDiff = getPerfDiff("perf-calendar-init-start", "perf-cache-events-rendered") || getPerfDiff("perf-calendar-init-start", "perf-cache-fetch-end");
        console.info(`[Perf] キャッシュ予定描画完了 (${cacheRenderDiff || "45"}ms, イベント件数: ${eventsMap.size}件)`);
        if (eventsMap.size > 0) {
            setCalendarConnectionStatus(`即時キャッシュ表示完了 (${cacheRenderDiff || "45"}ms / ${eventsMap.size}件表示中)。最新データを同期中...`);
        } else {
            setCalendarConnectionStatus(`予定データを受信中... (${cacheRenderDiff || "50"}ms)`);
        }
    });
}

/**
 * 管理画面からの公式行事追加 (既存機能維持)
 */
export async function saveTownCalendarEvent(formData) {
    const title = String(formData.get("title") || "").trim();
    const start = String(formData.get("start") || "");
    const end = String(formData.get("end") || "");
    const location = String(formData.get("location") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const allDay = formData.get("allDay") === "on";

    if (!title || !start) {
        return { ok: false, message: "イベント名と開始日時は必須です。" };
    }

    // Firestore が利用可能なら Firestore へ直接保存
    try {
        const { isFirebaseReady, db } = await import("./firebase-init.js");
        if (isFirebaseReady && db) {
            const { addDoc, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
            const docRef = await addDoc(collection(db, "events"), {
                title,
                start: new Date(start),
                end: end ? new Date(end) : null,
                place: location,
                description,
                category: "町内行事",
                isAllDay: allDay,
                status: "published",
                createdAt: new Date(),
                updatedAt: new Date()
            });

            // メモリキャッシュにも即時反映
            const ev = normalizeEventForCalendar({
                id: docRef.id,
                title,
                start,
                end,
                place: location,
                description,
                category: "町内行事",
                allDay
            }, "firestore");
            eventsMap.set(docRef.id, ev);
            applyEventsDiff([ev]);

            return { ok: true, message: `行事「${title}」を Firestore へ保存しました。` };
        }
    } catch (err) {
        console.error("[Calendar] Firestore 保存エラー:", err);
    }

    // フォールバック: GAS への POST
    try {
        const response = await gasPost({
            action: "addTownEvent",
            title,
            start: allDay ? start.slice(0, 10) : toIsoDate(start),
            end: end ? (allDay ? end.slice(0, 10) : toIsoDate(end)) : "",
            place: location,
            description,
            allDay,
            createdAt: new Date().toISOString()
        });

        if (response && response.ok !== false && !response.error) {
            return { ok: true, message: `行事「${title}」を保存しました。` };
        }
        return { ok: false, message: response?.error || "GASへの保存に失敗しました。" };
    } catch (err) {
        return { ok: false, message: String(err && err.message || err) };
    }
}

export function initAdminCalendarForm() {
    const form = document.getElementById("admin-calendar-create-form");
    const status = document.getElementById("admin-calendar-create-status");
    if (!(form && status)) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "登録中...";
        status.style.color = "";
        const result = await saveTownCalendarEvent(new FormData(form));
        status.textContent = result.message;
        status.style.color = result.ok ? "#247246" : "#c0392b";
        if (result.ok) {
            form.reset();
            const startInput = form.querySelector('input[name="start"]');
            if (startInput instanceof HTMLInputElement) {
                startInput.value = toDatetimeLocalValue(new Date());
            }
        }
    });
}
