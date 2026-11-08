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

/**
 * 各ページの業務コンテンツ初期化処理
 * 要件7: 会員データの取得は認証成功後に開始する。
 */
async function initializePageContent(page) {
    if (page === "home") {
        await runSafeInit(async () => setupHomePage(SITE_CONFIG));
    } else if (page === "events") {
        runSafeInit(async () => {
            const { initCalendarPage } = await import("./calendar.js");
            initCalendarPage(SITE_CONFIG);
        });
        runSafeInit(async () => {
            const { initManagedEventsPage } = await import("./community-admin.js");
            await initManagedEventsPage(SITE_CONFIG);
        });
    } else if (page === "documents") {
        await runSafeInit(async () => {
            const { initDocumentsPage } = await import("./drive.js");
            await initDocumentsPage(SITE_CONFIG);
        });
    } else if (page === "map") {
        await runSafeInit(async () => {
            const { initMapPage } = await import("./map.js");
            await initMapPage(SITE_CONFIG);
        });
    } else if (page === "equipment") {
        await runSafeInit(async () => {
            const { initFormsPage } = await import("./form.js");
            const { initEquipmentPage } = await import("./equipment.js");
            await initFormsPage(SITE_CONFIG);
            await initEquipmentPage(SITE_CONFIG);
        });
    } else if (page === "disaster") {
        await runSafeInit(async () => setupDisasterPage(SITE_CONFIG));
    } else if (page === "gallery") {
        await runSafeInit(async () => {
            const { initGalleryPage } = await import("./gallery.js");
            await initGalleryPage(SITE_CONFIG);
        });
    } else if (page === "opinion") {
        await runSafeInit(async () => {
            const { initOpinionExchangePage } = await import("./opinion-exchange.js");
            await initOpinionExchangePage(SITE_CONFIG);
        });
    }
}

/**
 * 要件2: 未ログイン時に業務コンテンツを隠蔽し、ログイン画面だけを表示する
 */
function showLoginGate(errorMessage = null) {
    let gate = document.getElementById("b-mode-login-gate");
    if (gate) {
        if (errorMessage) {
            const errEl = gate.querySelector("#gate-login-error");
            if (errEl) {
                errEl.textContent = errorMessage;
                errEl.style.display = "block";
            }
        }
        return;
    }

    // 業務コンテンツ (main, nav) を非表示保護
    const mains = document.querySelectorAll("main, .global-nav, .menu-toggle");
    mains.forEach((el) => {
        el.style.display = "none";
    });

    gate = document.createElement("section");
    gate.id = "b-mode-login-gate";
    gate.className = "card";
    gate.style.maxWidth = "460px";
    gate.style.margin = "48px auto";
    gate.style.padding = "28px 24px";
    gate.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)";
    gate.style.borderRadius = "8px";

    gate.innerHTML = `
        <div style="text-align:center; margin-bottom:20px;">
            <h1 style="margin:0 0 8px 0; font-size:1.4rem; color:#1a365d;">若松町内会 会員ログイン</h1>
            <p style="margin:0; font-size:0.9rem; color:#4a5568; line-height:1.5;">
                本ポータルは町内会員専用です。<br>
                閲覧・ご利用にはログインが必要です。
            </p>
        </div>
        <form id="gate-login-form" class="inline-form" style="display:flex; flex-direction:column; gap:14px;">
            <label style="font-weight:600; font-size:0.9rem; color:#2d3748;">ユーザーID
                <input name="userId" type="text" autocomplete="username" placeholder="例: member, officer, niina" required autofocus style="width:100%; box-sizing:border-box; padding:10px; margin-top:4px; border:1px solid #cbd5e1; border-radius:4px;">
            </label>
            <label style="font-weight:600; font-size:0.9rem; color:#2d3748;">パスワード
                <input name="password" type="password" autocomplete="current-password" placeholder="パスワード（または合言葉）" required style="width:100%; box-sizing:border-box; padding:10px; margin-top:4px; border:1px solid #cbd5e1; border-radius:4px;">
            </label>
            <button class="button" type="submit" style="width:100%; padding:11px; font-size:1rem; font-weight:bold; margin-top:8px;">ログイン</button>
            <div id="gate-login-error" style="color:#c53030; font-size:0.85rem; display:${errorMessage ? "block" : "none"}; background:#fff5f5; padding:8px 12px; border-radius:4px; border:1px solid #feb2b2; line-height:1.5;">${errorMessage || ""}</div>
            <div class="note" style="margin-top:10px; font-size:0.8rem; line-height:1.6; background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
                <strong>【利用可能なユーザーID】</strong><br>
                ・ <strong>member</strong>: 一般会員共通（閲覧専用 / パスワード欄に町内会合言葉を入力）<br>
                ・ <strong>officer</strong>: 役員共通（行事管理・写真承認・備品確認）<br>
                ・ <strong>niina</strong>: システム管理者（特権管理・ロール監査）
            </div>
        </form>
    `;

    // ページのメイン要素の直前に安全に挿入
    const mainEl = document.querySelector("main");
    if (mainEl && mainEl.parentNode) {
        mainEl.parentNode.insertBefore(gate, mainEl);
    } else {
        document.body.prepend(gate);
    }

    const form = gate.querySelector("#gate-login-form");
    const errorEl = gate.querySelector("#gate-login-error");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.style.display = "none";
        const userId = form.userId.value.trim();
        const password = form.password.value;

        const submitBtn = form.querySelector("button[type=submit]");
        submitBtn.disabled = true;
        submitBtn.textContent = "ログイン認証中...";

        try {
            const { signInWithUserId } = await import("./firebase-init.js");
            const res = await signInWithUserId(userId, password);
            if (!res.ok) {
                errorEl.textContent = res.message || "ユーザーIDまたはパスワードが正しくありません。";
                errorEl.style.display = "block";
                submitBtn.disabled = false;
                submitBtn.textContent = "ログイン";
                return;
            }
            // 認証＆権限確認が完了したため、ゲートを非表示にして安全に画面を初期化
            submitBtn.textContent = "ログイン成功！読み込み中...";
            await safeInitializePage(document.body.dataset.page);
        } catch (err) {
            errorEl.textContent = err.message || "通信エラーが発生しました。もう一度お試しください。";
            errorEl.style.display = "block";
            submitBtn.disabled = false;
            submitBtn.textContent = "ログイン";
        }
    });
}

let isPageInitialized = false;

async function safeInitializePage(page) {
    if (isPageInitialized) return;
    isPageInitialized = true;
    hideLoginGate();
    await initializePageContent(page);
}

function hideLoginGate() {
    const gate = document.getElementById("b-mode-login-gate");
    if (gate) gate.remove();
    const mains = document.querySelectorAll("main, .global-nav, .menu-toggle");
    mains.forEach((el) => {
        el.style.display = "";
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        setupNavigation();
    } catch {
        // ナビゲーション初期化失敗は他機能へ波及させない。
    }
    const page = document.body.dataset.page;

    // admin ページは統一ログインUIそのものを含むため直接初期化
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
        return;
    }

    // 要件1, 2, 7: B方式 認証ガード
    // 未ログインでは業務データを一切取得せず、ログイン画面だけを表示する
    try {
        const { isFirebaseReady, auth, onAuthStateChanged, getCurrentUserProfile } = await import("./firebase-init.js");

        // テスト・ローカル検証用モックユーザー確認
        let mockUser = null;
        try {
            const rawMock = sessionStorage.getItem("wakamatsu_mock_user");
            if (rawMock) mockUser = JSON.parse(rawMock);
        } catch {}

        if (mockUser && (mockUser.role === "member" || mockUser.role === "officer" || mockUser.role === "admin")) {
            await safeInitializePage(page);
            return;
        }

        if (isFirebaseReady && auth) {
            onAuthStateChanged(auth, async (user) => {
                if (!user) {
                    // 未ログイン: 初期化フラグをリセットしログイン画面を表示 (要件2)
                    isPageInitialized = false;
                    showLoginGate();
                    return;
                }

                // ログイン中: 権限を厳密確認 (要件4)
                const profile = await getCurrentUserProfile();
                if (!profile || !profile.isMember) {
                    isPageInitialized = false;
                    let detailMsg = "会員登録が確認できませんでした。管理者にお問い合わせください。";
                    if (profile) {
                        if (profile.status === "NOT_FOUND" || !profile.docExists) {
                            detailMsg = `Firebase認証済みですが、Firestore users/${user.uid} にドキュメントが存在しません。Firebase Consoleで登録してください。`;
                        } else if (profile.status === "PERMISSION_DENIED") {
                            detailMsg = `Firestoreアクセス権限エラー (permission-denied): users/${user.uid} のドキュメントIDを確認してください。`;
                        } else if (profile.role === "guest") {
                            detailMsg = `アカウントの権限(role)が無効です (role="guest")。管理者に権限設定をご確認ください。`;
                        }
                    }
                    showLoginGate(detailMsg);
                    return;
                }

                // 認証成功: ゲートを解除して安全に業務画面を初期化 (要件7)
                await safeInitializePage(page);
            });
            return;
        } else {
            // Firebase未構成時も未認証アクセスは遮断しログインゲートを表示 (要件1 & 2)
            showLoginGate();
            return;
        }
    } catch (err) {
        console.warn("[AuthGate] 認証ガード初期化例外:", err);
        showLoginGate();
        return;
    }
});
