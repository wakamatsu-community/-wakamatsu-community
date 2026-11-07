import { SITE_CONFIG } from "./config.js";
import { initCalendarPage } from "./calendar.js";
import { gasGet } from "./gas-api.js";
import { initDocumentsPage } from "./drive.js";
import { initMapPage } from "./map.js";
import { initFormsPage } from "./form.js";
import { initGalleryPage } from "./gallery.js";
import { initEquipmentPage, initAdminReturnAlerts } from "./equipment.js";
import { initManagedEventsPage, initAdminCommunityForms, loadAllManagedEvents } from "./community-admin.js";
import { initOpinionExchangePage, initAdminOpinionExchange } from "./opinion-exchange.js";
import { db, isFirebaseReady, auth, onAuthStateChanged, getCurrentUserProfile } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function setupNavigation() {
    const current = location.pathname.split("/").pop() || "index.html";
    const links = document.querySelectorAll(".nav-link");

    links.forEach((link) => {
        const href = link.getAttribute("href");
        if (href === current || (current === "" && href === "index.html")) {
            link.classList.add("active");
        }
    });

    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".global-nav");
    if (toggle && nav) {
        toggle.addEventListener("click", () => {
            nav.classList.toggle("open");
        });
    }

    // Firebase ログイン状態の監視とナビ表示更新
    if (isFirebaseReady && auth) {
        onAuthStateChanged(auth, async (user) => {
            const authPills = document.querySelectorAll(".auth-pill, #nav-auth-link");
            if (user) {
                const profile = await getCurrentUserProfile();
                const displayName = profile?.name || user.displayName || user.email || "会員";
                const roleBadge = profile?.role === "officer" ? "（役員）" : "";
                authPills.forEach((el) => {
                    el.textContent = `👤 ${displayName}${roleBadge}`;
                    el.setAttribute("href", "admin.html");
                });
            } else {
                authPills.forEach((el) => {
                    el.textContent = "ログイン";
                    el.setAttribute("href", "admin.html");
                });
            }
        });
    }
}

function isCommunityEvent(event) {
    const text = `${event?.category || ""} ${event?.title || ""}`.toLowerCase();
    return text.includes("学び")
        || text.includes("コミニティ")
        || text.includes("コミュニティ")
        || text.includes("コミュニティー")
        || text.includes("community");
}

function parseEventDate(scheduleLabel) {
    const matched = String(scheduleLabel || "").match(/(\d{4}-\d{2}-\d{2})/);
    if (!matched) {
        return null;
    }
    const date = new Date(`${matched[1]}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateLabel(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
    return `${month}/${day}(${weekday})`;
}

function getCurrentMonthNumber() {
    return new Date().getMonth() + 1;
}

function isCurrentMonth(date) {
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function normalizeTownEventForHome(event) {
    const startDate = String(event?.start || "");
    const fallbackDate = startDate ? startDate.slice(0, 10) : "";
    const dateText = String(event?.date || fallbackDate || "");
    const timeText = String(event?.time || "");
    const date = dateText ? new Date(`${dateText}T00:00:00`) : null;
    const scheduleLabel = dateText
        ? (timeText ? `${dateText} ${timeText}` : dateText)
        : "日時未設定";
    const start = date && !Number.isNaN(date.getTime())
        ? `${dateText}T00:00:00`
        : "";

    return {
        id: String(event?.eventId || event?.id || ""),
        type: "town",
        title: String(event?.title || ""),
        description: String(event?.note || event?.description || ""),
        scheduleLabel,
        category: "町内行事",
        sourceLabel: "町内行事",
        date: date && !Number.isNaN(date.getTime()) ? date : null,
        start
    };
}

async function loadTownEventsForHome() {
    // 1. Firestore からの取得を優先
    if (isFirebaseReady && db) {
        try {
            const snap = await getDocs(collection(db, "events"));
            const events = [];
            snap.forEach((docSnap) => {
                const d = docSnap.data();
                const startStr = d.start && typeof d.start.toDate === "function" ? d.start.toDate().toISOString() : String(d.start || "");
                events.push(normalizeTownEventForHome({
                    id: docSnap.id,
                    title: d.title,
                    start: startStr,
                    place: d.place,
                    description: d.description
                }));
            });
            if (events.length > 0) {
                return events.filter((e) => e.title && e.date);
            }
        } catch (err) {
            console.warn("[Home] Firestore 取得エラー (GASへフォールバック):", err);
        }
    }

    // 2. GAS フォールバック
    try {
        const response = await gasGet({ action: "getTownEvents" });
        const rows = Array.isArray(response?.data) ? response.data : [];
        return rows.map(normalizeTownEventForHome).filter((event) => event.title && event.date);
    } catch (error) {
        console.error("Failed to load town events from GAS:", error);
        return [];
    }
}

function renderHomeMonthlyEvents(statusEl, listEl, events) {
    const month = getCurrentMonthNumber();
    const monthlyEvents = events
        .map((event) => ({
            ...event,
            date: parseEventDate(event.scheduleLabel)
        }))
        .filter((event) => event.type === "recurring" || (event.date && isCurrentMonth(event.date)));

    if (statusEl) {
        statusEl.textContent = `${month}月の行事予定は${monthlyEvents.length}件です。`;
    }

    if (monthlyEvents.length === 0) {
        listEl.innerHTML = "<li><strong>今月:</strong> 行事予定はありません</li>";
        return;
    }

    listEl.innerHTML = "";
    monthlyEvents.forEach((event) => {
        const li = document.createElement("li");
        const schedule = event.scheduleLabel || "日時未設定";
        const content = event.title || "行事名未設定";
        const supplement = event.description || "補足なし";
        li.innerHTML = `<strong>${content}</strong><br>予定: ${schedule}<br>補足: ${supplement}`;
        listEl.appendChild(li);
    });
}

async function setupHomePage(config) {
    const emergency = document.getElementById("emergency-text");
    if (emergency) {
        emergency.textContent = config?.emergency?.message || emergency.textContent;
    }

    const monthlyStatus = document.getElementById("home-monthly-status");
    const monthlyList = document.getElementById("home-monthly-list");
    if (!monthlyList) {
        return;
    }

    const [managedEvents, townEvents] = await Promise.all([
        loadAllManagedEvents(config),
        loadTownEventsForHome()
    ]);
    const communityEvents = Array.isArray(managedEvents) ? managedEvents : [];
    const combinedEvents = [
        ...townEvents,
        ...communityEvents
    ];

    renderHomeMonthlyEvents(monthlyStatus, monthlyList, combinedEvents);
}

function setupDisasterPage(config) {
    const manual = document.getElementById("disaster-manual-link");
    if (manual) {
        manual.href = config?.drive?.disasterManualUrl || "#";
    }
}

async function runSafeInit(initFn) {
    try {
        await initFn();
    } catch {
        // スタンドアロンテストモードでは個別初期化失敗を握りつぶして続行する。
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        setupNavigation();
    } catch {
        // ナビゲーション初期化失敗は他機能へ波及させない。
    }
    const page = document.body.dataset.page;

    if (page === "home") {
        await runSafeInit(async () => setupHomePage(SITE_CONFIG));
    }

    if (page === "events") {
        await runSafeInit(async () => initCalendarPage(SITE_CONFIG));
        await runSafeInit(async () => initManagedEventsPage(SITE_CONFIG));
    }

    if (page === "documents") {
        await runSafeInit(async () => initDocumentsPage(SITE_CONFIG));
    }

    if (page === "map") {
        await runSafeInit(async () => initMapPage(SITE_CONFIG));
    }

    if (page === "equipment") {
        await runSafeInit(async () => initFormsPage(SITE_CONFIG));
    }

    if (page === "equipment") {
        await runSafeInit(async () => initEquipmentPage(SITE_CONFIG));
    }

    if (page === "disaster") {
        await runSafeInit(async () => setupDisasterPage(SITE_CONFIG));
    }

    if (page === "gallery") {
        await runSafeInit(async () => initGalleryPage(SITE_CONFIG));
    }

    if (page === "opinion") {
        await runSafeInit(async () => initOpinionExchangePage(SITE_CONFIG));
    }

    if (page === "admin") {
        const adminConfig = SITE_CONFIG || {};
        await runSafeInit(async () => initAdminCommunityForms(adminConfig));
        await runSafeInit(async () => initAdminReturnAlerts(adminConfig));
        await runSafeInit(async () => initManagedEventsPage(adminConfig));
        await runSafeInit(async () => initAdminOpinionExchange(adminConfig));
    }
});
