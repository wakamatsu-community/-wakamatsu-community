/**
 * 若松町内会ホームページ 行事カレンダーモジュール
 *
 * - FullCalendar (月/週/リスト表示、スマホ最適化)
 * - SWRパターンによる即時表示 (Docs/events.json キャッシュ → Firestore/GAS最新同期)
 * - カテゴリ別色分け & リアルタイムカテゴリフィルタリング
 * - 表示所要時間の計測
 * - 誤表示タイマーの完全撤去
 */

import { gasGet, gasPost, getGasUrl } from "./gas-api.js";
import { loadAllManagedEvents } from "./community-admin.js";
import { db, isFirebaseReady } from "./firebase-init.js";
import { collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCAL_ADDED_EVENTS_KEY = "wakamatsu_calendar_added_events_v1";

// 全保持イベントリスト（カテゴリフィルタ用）
let allCalendarEvents = [];
let fullCalendarInstance = null;
let currentFilterCategory = "all";

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

function buildScheduleTiming(dateValue, timeValue) {
    const date = String(dateValue || "").trim();
    const time = String(timeValue || "").trim();
    if (!date) {
        return { start: "", end: "", allDay: false };
    }

    const buildIso = (text) => {
        if (!text) return date;
        const matched = String(text).match(/^(\d{1,2}):(\d{2})/);
        if (!matched) return date;
        return `${date}T${matched[1].padStart(2, "0")}:${matched[2]}:00`;
    };

    const parts = time.split(/\s*[-〜~]\s*/);
    const start = buildIso(parts[0] || time);
    const end = parts[1] ? buildIso(parts[1]) : "";
    return { start, end, allDay: !time };
}

function normalizeEventForCalendar(raw, source = "gas") {
    const timing = buildScheduleTiming(raw?.date || raw?.startDate || "", raw?.time || "");
    const startValue = raw?.start || raw?.startDateTime || raw?.startDate || timing.start;
    const endValue = raw?.end || raw?.endDateTime || raw?.endDate || timing.end;
    const allDay = Boolean(raw?.allDay || timing.allDay || (String(startValue).length === 10 && !String(startValue).includes("T")));
    const category = String(raw?.category || (source === "community" ? "コミニティ" : "町内行事")).trim();
    const colors = getCategoryColor(category);

    const title = String(raw?.title || raw?.summary || "(タイトル未設定)").trim();
    const id = String(raw?.id || raw?.eventId || `${title}_${startValue}`);

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
            organizer: raw?.organizer || raw?.creator || "",
            source
        }
    };
}

/**
 * 1. 静的キャッシュ (Docs/events.json) から即時読み込み (SWR)
 */
async function fetchEventsFromStaticJson() {
    try {
        const res = await fetch("Docs/events.json", { cache: "no-cache" });
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);
        return list.map((item) => normalizeEventForCalendar(item, "cache")).filter((e) => e.start);
    } catch {
        return [];
    }
}

/**
 * 2. Cloud Firestore からの最新行事・企画イベント取得
 */
async function fetchEventsFromFirestore() {
    if (!isFirebaseReady || !db) return null;

    try {
        const eventsList = [];

        // 2-1. 公式行事 (events コレクション)
        const eventsRef = collection(db, "events");
        const eventsSnap = await getDocs(eventsRef);
        eventsSnap.forEach((docSnap) => {
            const d = docSnap.data();
            const startStr = d.start && typeof d.start.toDate === "function" ? d.start.toDate().toISOString() : String(d.start || "");
            const endStr = d.end && typeof d.end.toDate === "function" ? d.end.toDate().toISOString() : String(d.end || "");
            eventsList.push(normalizeEventForCalendar({
                id: docSnap.id,
                title: d.title,
                start: startStr,
                end: endStr,
                place: d.place,
                description: d.description,
                category: d.category || "町内行事",
                allDay: d.isAllDay
            }, "firestore"));
        });

        // 2-2. 会員企画イベント (communityEvents コレクション, status == 'approved')
        const commRef = collection(db, "communityEvents");
        const commQuery = query(commRef, where("status", "==", "approved"));
        const commSnap = await getDocs(commQuery);
        commSnap.forEach((docSnap) => {
            const d = docSnap.data();
            const startStr = d.start && typeof d.start.toDate === "function" ? d.start.toDate().toISOString() : String(d.start || "");
            const endStr = d.end && typeof d.end.toDate === "function" ? d.end.toDate().toISOString() : String(d.end || "");
            eventsList.push(normalizeEventForCalendar({
                id: docSnap.id,
                title: d.title,
                start: startStr,
                end: endStr,
                place: d.place,
                description: d.description,
                category: d.category || "コミニティ",
                organizer: d.organizerName
            }, "community"));
        });

        return eventsList.filter((e) => e.start);
    } catch (err) {
        console.warn("[Calendar] Firestore 取得エラー (フォールバックへ進みます):", err);
        return null;
    }
}

/**
 * 3. GAS バックエンドからの取得 (フォールバック)
 */
async function fetchEventsFromGas(config) {
    try {
        const [townPayload, managed] = await Promise.all([
            gasGet({ action: "getTownEvents" }).catch(() => ({ data: [] })),
            loadAllManagedEvents(config).catch(() => [])
        ]);

        const townEvents = Array.isArray(townPayload?.data) ? townPayload.data : (Array.isArray(townPayload) ? townPayload : []);
        const normalizedTown = townEvents.map((item) => normalizeEventForCalendar(item, "gas"));

        const normalizedManaged = (Array.isArray(managed) ? managed : []).map((m) => {
            const start = m.start || (m.date ? `${m.date}T09:00:00` : "");
            return normalizeEventForCalendar({
                id: m.id,
                title: m.title,
                start,
                place: m.place,
                description: m.description,
                category: m.category || "コミニティ"
            }, "community");
        });

        return [...normalizedTown, ...normalizedManaged].filter((e) => e.start);
    } catch (error) {
        console.error("[Calendar] GAS 取得エラー:", error);
        return [];
    }
}

/**
 * 重複除外マージ
 */
function mergeEvents(targetMap, newEvents) {
    newEvents.forEach((event) => {
        const key = `${event.title}_${event.start.slice(0, 10)}`;
        targetMap.set(key, event);
    });
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
 * カテゴリでカレンダーを絞り込み表示する
 */
function applyCategoryFilter(category) {
    currentFilterCategory = category;
    if (!fullCalendarInstance) return;

    fullCalendarInstance.removeAllEvents();

    const filtered = currentFilterCategory === "all"
        ? allCalendarEvents
        : allCalendarEvents.filter((e) => {
            const cat = String(e.extendedProps?.category || "");
            return cat.includes(currentFilterCategory) || e.title.includes(currentFilterCategory);
        });

    filtered.forEach((e) => fullCalendarInstance.addEvent(e));

    const filterButtons = document.querySelectorAll(".filter-pill");
    filterButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.category === category);
    });

    setCalendarConnectionStatus(`表示中: ${filtered.length}件 (${category === "all" ? "全カテゴリ" : category})`);
}

function bindFilterPills() {
    const buttons = document.querySelectorAll(".filter-pill");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const cat = btn.dataset.category || "all";
            applyCategoryFilter(cat);
        });
    });
}

/**
 * 行事カレンダー初期化
 */
export async function initCalendarPage(config = {}) {
    const calendarRoot = document.getElementById("custom-calendar");
    if (!calendarRoot) return;

    if (!window.FullCalendar) {
        setCalendarConnectionStatus("FullCalendarの読み込みに失敗しました。", true);
        return;
    }

    const startTime = performance.now();
    setCalendarConnectionStatus("カレンダーを初期化中...");

    // FullCalendar 初期化
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
        }
    });

    fullCalendarInstance.render();
    bindFilterPills();

    const eventsMap = new Map();

    // ステップ1: 静的キャッシュ (Docs/events.json) を即時適用
    const staticEvents = await fetchEventsFromStaticJson();
    if (staticEvents.length > 0) {
        mergeEvents(eventsMap, staticEvents);
        allCalendarEvents = Array.from(eventsMap.values());
        allCalendarEvents.forEach((e) => fullCalendarInstance.addEvent(e));
        const instantTime = ((performance.now() - startTime) / 1000).toFixed(2);
        setCalendarConnectionStatus(`即時キャッシュ表示完了 (${instantTime}秒 / ${allCalendarEvents.length}件)。最新データを同期中...`);
    }

    // ステップ2: Firestore (優先) または GAS (フォールバック) から最新データ取得
    try {
        let liveEvents = await fetchEventsFromFirestore();
        let sourceName = "Firestore";

        if (!liveEvents) {
            liveEvents = await fetchEventsFromGas(config);
            sourceName = "GAS";
        }

        if (Array.isArray(liveEvents) && liveEvents.length > 0) {
            mergeEvents(eventsMap, liveEvents);
            fullCalendarInstance.removeAllEvents();
            allCalendarEvents = Array.from(eventsMap.values());
            allCalendarEvents.forEach((e) => fullCalendarInstance.addEvent(e));

            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            setCalendarConnectionStatus(`最新データ同期完了 [${sourceName}]: ${totalTime}秒 (${allCalendarEvents.length}件表示中)`);
        } else if (allCalendarEvents.length === 0) {
            setCalendarConnectionStatus("登録済みの行事予定はありません。");
        }
    } catch (err) {
        console.error("[Calendar] 最新データ同期エラー:", err);
        if (allCalendarEvents.length > 0) {
            setCalendarConnectionStatus(`最新同期に失敗しましたが、キャッシュデータを表示中です (${allCalendarEvents.length}件)`);
        } else {
            setCalendarConnectionStatus("行事データの読み込みに失敗しました。再読み込みをお試しください。", true);
        }
    }
}

/**
 * 管理画面からの公式行事追加
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
            const { addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
            await addDoc(collection(db, "events"), {
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
