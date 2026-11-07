import { SITE_CONFIG } from "./config.js";

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

    // Firebase ログイン状態の監視 (初期描画を一切ブロックしないよう遅延非同期ロード)
    setTimeout(async () => {
        try {
            const { isFirebaseReady, auth, onAuthStateChanged, getCurrentUserProfile } = await import("./firebase-init.js");
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
        } catch {
            // 認証初期化エラーはナビゲーションに影響させない
        }
    }, 100);
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
    // 1. 高速静的キャッシュ (Docs/events.json) からの即時読み込み (SWR)
    try {
        const res = await fetch("Docs/events.json", { cache: "no-cache" });
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (Array.isArray(data?.events) ? data.events : []);
            if (list.length > 0) {
                return list.map(normalizeTownEventForHome).filter((event) => event.title && event.date);
            }
        }
    } catch {
        // キャッシュ取得失敗時は後続へ
    }

    // 2. Firestore からの取得を優先 (遅延インポート)
    try {
        const { isFirebaseReady, db } = await import("./firebase-init.js");
        if (isFirebaseReady && db) {
            const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
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
        }
    } catch (err) {
        console.warn("[Home] Firestore 取得スキップ:", err);
    }

    // 3. 取得できない場合は空配列
    return [];
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

    const { loadAllManagedEvents } = await import("./community-admin.js");
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
        // カレンダー画面ではカレンダー初期化を最優先で即時起動
        runSafeInit(async () => {
            const { initCalendarPage } = await import("./calendar.js");
            initCalendarPage(SITE_CONFIG);
        });
        runSafeInit(async () => {
            const { initManagedEventsPage } = await import("./community-admin.js");
            await initManagedEventsPage(SITE_CONFIG);
        });
    }

    if (page === "documents") {
        await runSafeInit(async () => {
            const { initDocumentsPage } = await import("./drive.js");
            await initDocumentsPage(SITE_CONFIG);
        });
    }

    if (page === "map") {
        await runSafeInit(async () => {
            const { initMapPage } = await import("./map.js");
            await initMapPage(SITE_CONFIG);
        });
    }

    if (page === "equipment") {
        await runSafeInit(async () => {
            const { initFormsPage } = await import("./form.js");
            const { initEquipmentPage } = await import("./equipment.js");
            await initFormsPage(SITE_CONFIG);
            await initEquipmentPage(SITE_CONFIG);
        });
    }

    if (page === "disaster") {
        await runSafeInit(async () => setupDisasterPage(SITE_CONFIG));
    }

    if (page === "gallery") {
        await runSafeInit(async () => {
            const { initGalleryPage } = await import("./gallery.js");
            await initGalleryPage(SITE_CONFIG);
        });
    }

    if (page === "opinion") {
        await runSafeInit(async () => {
            const { initOpinionExchangePage } = await import("./opinion-exchange.js");
            await initOpinionExchangePage(SITE_CONFIG);
        });
    }

    if (page === "admin") {
        await runSafeInit(async () => {
            const { initAdminCommunityForms, initAdminReturnAlerts, initManagedEventsPage } = await import("./community-admin.js");
            const { initAdminOpinionExchange } = await import("./opinion-exchange.js");
            const adminConfig = SITE_CONFIG || {};
            await initAdminCommunityForms(adminConfig);
            await initAdminReturnAlerts(adminConfig);
            await initManagedEventsPage(adminConfig);
            await initAdminOpinionExchange(adminConfig);
        });
    }
});
