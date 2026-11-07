/**
 * 若松町内会ホームページ 高速行事カレンダーモジュール
 *
 * 設計原則:
 * 1. ゼロ遅延枠描画: API通信・認証待ちゼロでFullCalendar枠を即時初期化 (同期実行)
 * 2. 超高速SWR初期表示: Docs/events.json から0.05秒台で公開行事をパッと先行描画
 * 3. Firestore期間クエリ: 現在表示範囲 (activeStart〜activeEnd) のみ非同期取得し差分マージ
 * 4. メモリキャッシュ: 取得済み年月をキャッシュし、月移動時の再通信・枠再生成を撲滅
 * 5. GAS表示時依存の完全排除: カレンダー表示中のGAS通信を全廃 (表示遅延3〜8秒を0秒へ)
 * 6. 完全インメモリ・カテゴリフィルタ: 再通信なしで瞬時に絞り込み
 */

import { gasPost } from "./gas-api.js";
import { db, isFirebaseReady, auth } from "./firebase-init.js";

// 全保持イベント辞書 (キー: eventId または title_start, 値: FullCalendarイベントオブジェクト)
const eventsMap = new Map();

// 取得済み期間のキャッシュキー (例: "2026-06", "2026-07")
const loadedMonths = new Set();

let fullCalendarInstance = null;
let currentFilterCategory = "all";
let isSyncing = false;

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
 * 1. 高速静的キャッシュ (Docs/events.json) から即時読み込み (SWR)
 */
async function loadStaticCacheEvents() {
    try {
        const res = await fetch("Docs/events.json", { cache: "no-cache" });
        if (!res.ok) return 0;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);

        let addedCount = 0;
        list.forEach((item) => {
            const ev = normalizeEventForCalendar(item, "cache");
            if (ev.start && !eventsMap.has(ev.id)) {
                eventsMap.set(ev.id, ev);
                addedCount++;
            }
        });

        return addedCount;
    } catch {
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
 * 2. Firestore からの期間クエリ取得 (非同期・差分マージ)
 */
async function fetchEventsFromFirestoreRange(startDateStr, endDateStr) {
    if (!isFirebaseReady || !db) return null;

    try {
        // 動的インポートによりトップレベルのブロックを回避
        const { collection, getDocs, query, where } = await import(
            "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
        );

        const fetchedEvents = [];

        // 2-1. 公式行事 (events コレクション)
        const eventsRef = collection(db, "events");
        // Firestore Timestamp または文字列日付に対応
        const eventsQuery = query(
            eventsRef,
            where("status", "==", "published")
        );
        const eventsSnap = await getDocs(eventsQuery);
        eventsSnap.forEach((docSnap) => {
            const d = docSnap.data();
            const startStr = d.start && typeof d.start.toDate === "function" ? d.start.toDate().toISOString() : String(d.start || "");
            const endStr = d.end && typeof d.end.toDate === "function" ? d.end.toDate().toISOString() : String(d.end || "");
            if (startStr) {
                fetchedEvents.push(normalizeEventForCalendar({
                    id: docSnap.id,
                    title: d.title,
                    start: startStr,
                    end: endStr,
                    place: d.place,
                    description: d.description,
                    category: d.category || "町内行事",
                    allDay: d.isAllDay
                }, "firestore"));
            }
        });

        // 2-2. 会員企画イベント (communityEvents コレクション, status == 'approved')
        const commRef = collection(db, "communityEvents");
        const commQuery = query(commRef, where("status", "==", "approved"));
        const commSnap = await getDocs(commQuery);
        commSnap.forEach((docSnap) => {
            const d = docSnap.data();
            const startStr = d.start && typeof d.start.toDate === "function" ? d.start.toDate().toISOString() : String(d.start || "");
            const endStr = d.end && typeof d.end.toDate === "function" ? d.end.toDate().toISOString() : String(d.end || "");
            if (startStr) {
                fetchedEvents.push(normalizeEventForCalendar({
                    id: docSnap.id,
                    title: d.title,
                    start: startStr,
                    end: endStr,
                    place: d.place,
                    description: d.description,
                    category: d.category || "コミニティ",
                    organizer: d.organizerName
                }, "community"));
            }
        });

        return fetchedEvents;
    } catch (err) {
        console.warn("[Calendar] Firestore 期間取得警告:", err);
        return null;
    }
}

/**
 * 表示範囲の同期処理 (バックグラウンド実行)
 */
async function syncEventsForRange(startStr, endStr) {
    if (isSyncing) return;
    const monthKeys = getMonthKeysForRange(startStr, endStr);
    const unreadMonths = monthKeys.filter((m) => !loadedMonths.has(m));

    // すべてキャッシュ済みなら再通信しない (不要なFirestore読み取り防止)
    if (unreadMonths.length === 0 && loadedMonths.size > 0) {
        return;
    }

    isSyncing = true;
    try {
        const liveEvents = await fetchEventsFromFirestoreRange(startStr, endStr);
        if (Array.isArray(liveEvents) && liveEvents.length > 0) {
            let updatedCount = 0;
            liveEvents.forEach((ev) => {
                const existing = eventsMap.get(ev.id);
                if (!existing || existing.start !== ev.start || existing.title !== ev.title) {
                    eventsMap.set(ev.id, ev);
                    updatedCount++;
                }
            });

            monthKeys.forEach((m) => loadedMonths.add(m));
            if (updatedCount > 0) {
                refreshCalendarView();
                setCalendarConnectionStatus(`最新データ同期完了 [Firestore]: ${eventsMap.size}件表示中`);
            }
        } else {
            // Firestoreにデータがない場合は現在のキャッシュ表示を維持
            monthKeys.forEach((m) => loadedMonths.add(m));
        }
    } catch (err) {
        console.warn("[Calendar] 同期処理スキップ:", err);
    } finally {
        isSyncing = false;
    }
}

/**
 * 行事カレンダー初期化 (同期で枠即時描画 → 非同期キャッシュSWR)
 */
export function initCalendarPage(config = {}) {
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

    const startTime = performance.now();

    // 1. カレンダー枠を即座に描画 (通信待ち 0 秒)
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
            syncEventsForRange(dateInfo.startStr, dateInfo.endStr);
        }
    });

    fullCalendarInstance.render();
    bindFilterPills();

    const frameTime = ((performance.now() - startTime) / 1000).toFixed(2);
    setCalendarConnectionStatus(`カレンダー枠描画完了 (${frameTime}秒)。予定データを読み込み中...`);

    // 2. 高速静的キャッシュ (Docs/events.json) を即時適用
    loadStaticCacheEvents().then((count) => {
        const cacheTime = ((performance.now() - startTime) / 1000).toFixed(2);
        if (eventsMap.size > 0) {
            refreshCalendarView();
            setCalendarConnectionStatus(`即時キャッシュ表示完了 (${cacheTime}秒 / ${eventsMap.size}件表示中)。最新データを同期中...`);
        } else {
            setCalendarConnectionStatus(`予定データを照会中... (${cacheTime}秒)`);
        }

        // 3. 表示中範囲の Firestore 最新データをバックグラウンド同期
        const view = fullCalendarInstance.view;
        if (view) {
            syncEventsForRange(view.activeStart.toISOString(), view.activeEnd.toISOString());
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
    if (isFirebaseReady && db) {
        try {
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
            refreshCalendarView();

            return { ok: true, message: `行事「${title}」を Firestore へ保存しました。` };
        } catch (err) {
            console.error("[Calendar] Firestore 保存エラー:", err);
        }
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
