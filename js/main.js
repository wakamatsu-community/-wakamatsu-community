import { SITE_CONFIG } from "./config.js";
import { initCalendarPage } from "./calendar.js";
import { initDocumentsPage } from "./drive.js";
import { initMapPage } from "./map.js";
import { initFormsPage } from "./form.js";
import { initGalleryPage } from "./gallery.js";
import { initEquipmentPage, initAdminReturnAlerts } from "./equipment.js";
import { initManagedEventsPage, initAdminCommunityForms, loadAllManagedEvents } from "./community-admin.js";
import { initOpinionExchangePage, initAdminOpinionExchange } from "./opinion-exchange.js";

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
    if (!toggle || !nav) {
        return;
    }

    toggle.addEventListener("click", () => {
        nav.classList.toggle("open");
    });
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

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
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

function renderHomeNews(listEl, events) {
    const today = startOfDay(new Date());
    const weekEnd = addDays(today, 7);

    const weeklyEvents = events
        .map((event) => ({
            ...event,
            date: parseEventDate(event.scheduleLabel),
            sourceLabel: isCommunityEvent(event) ? "コミニティ" : "行事予定"
        }))
        .filter((event) => event.date && event.date >= today && event.date < weekEnd)
        .sort((a, b) => a.date - b.date)
        .slice(0, 8);

    if (weeklyEvents.length === 0) {
        listEl.innerHTML = "<li><strong>今週:</strong> 新しい行事予定はありません</li>";
        return;
    }

    listEl.innerHTML = "";
    weeklyEvents.forEach((event) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${formatDateLabel(event.date)}:</strong> [${event.sourceLabel}] ${event.title}`;
        listEl.appendChild(li);
    });
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

    const newsList = document.getElementById("home-news-list");
    const monthlyStatus = document.getElementById("home-monthly-status");
    const monthlyList = document.getElementById("home-monthly-list");
    if (!newsList) {
        return;
    }

    const events = await loadAllManagedEvents(config);
    renderHomeNews(newsList, events);
    if (monthlyList) {
        renderHomeMonthlyEvents(monthlyStatus, monthlyList, events);
    }
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
