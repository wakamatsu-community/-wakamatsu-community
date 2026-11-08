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
 * 会員専用操作の実行時に認証状態を確認し、未ログインならモーダルを表示する
 * @param {Object} options
 * @param {string} [options.actionLabel] 操作名（例: "備品予約", "参加申込"）
 * @param {string} [options.buttonLabel] フォームの確定ボタン表示名（例: "予約を登録"）
 * @param {Function} [options.onSuccess] 認証済みまたは認証成功時の即時コールバック
 * @param {HTMLElement} [options.statusEl] 案内表示用要素
 * @param {boolean} [options.officerOnly] 責任者以上の権限が必要か
 * @returns {Promise<boolean>} 許可された場合は true、未ログイン等で中断した場合は false
 */
export async function requireMemberAuth(options = {}) {
    try {
        const { isFirebaseReady, auth, getCurrentUserProfile } = await import("./firebase-init.js");
        if (!isFirebaseReady || !auth) {
            if (options.statusEl) {
                options.statusEl.textContent = "現在認証システムが利用できません。";
                options.statusEl.style.color = "#c0392b";
            }
            return false;
        }

        if (auth.currentUser) {
            const profile = await getCurrentUserProfile();
            if (profile) {
                if (options.officerOnly && !profile.isOfficer) {
                    if (options.statusEl) {
                        options.statusEl.textContent = "この操作は役員・管理者アカウントでのみ利用できます。";
                        options.statusEl.style.color = "#c0392b";
                    }
                    return false;
                }
                if (profile.isMember) {
                    if (typeof options.onSuccess === "function") {
                        await options.onSuccess(profile);
                    }
                    return true;
                }
            }
        }

        // 未ログインまたは権限不足: モーダルを表示して案内
        showAuthModal(options);
        return false;
    } catch (err) {
        console.warn("[Auth] 認証確認例外:", err);
        return false;
    }
}

/**
 * 会員ログインモーダルを表示する（入力値を保持し、ログイン後に手動確認を促す）
 */
export function showAuthModal(options = {}) {
    let modal = document.getElementById("action-auth-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "action-auth-modal";
        modal.className = "modal-overlay";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.innerHTML = `
            <section class="modal-card" style="max-width:440px; margin:auto;">
                <h2 id="action-auth-modal-title" style="margin:0 0 8px 0; font-size:1.3rem; color:#1a365d;">会員ログイン</h2>
                <p id="action-auth-modal-desc" class="note" style="margin-bottom:14px; font-size:0.9rem;"></p>
                <form id="action-auth-form" class="inline-form" style="display:flex; flex-direction:column; gap:12px;">
                    <label style="font-size:0.9rem; font-weight:600;">ユーザーID
                        <input name="userId" type="text" autocomplete="username" placeholder="例: member, officer, niina" required autofocus style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:4px;">
                    </label>
                    <label style="font-size:0.9rem; font-weight:600;">パスワード
                        <input name="password" type="password" autocomplete="current-password" placeholder="パスワード（または合言葉）" required style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:4px;">
                    </label>
                    <div class="button-row modal-button-row" style="margin-top:8px;">
                        <button class="button" type="submit" id="action-auth-submit-btn">ログイン</button>
                        <button class="button" type="button" id="action-auth-close-btn">キャンセル</button>
                    </div>
                    <p id="action-auth-status" class="note" aria-live="polite" style="margin-top:6px; color:#c0392b; display:none;"></p>
                    <div class="note" style="margin-top:8px; font-size:0.8rem; line-height:1.5; background:#f8fafc; padding:8px; border-radius:4px;">
                        ・ <strong>member</strong>: 一般会員共通（パスワード欄に合言葉を入力）<br>
                        ・ <strong>officer</strong>: 役員共通 / <strong>niina</strong>: 管理者
                    </div>
                </form>
            </section>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector("#action-auth-close-btn");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                modal.classList.add("hidden");
                modal.style.display = "none";
                document.body.style.overflow = "";
            });
        }
    }

    const descEl = modal.querySelector("#action-auth-modal-desc");
    const statusEl = modal.querySelector("#action-auth-status");
    const form = modal.querySelector("#action-auth-form");
    const submitBtn = modal.querySelector("#action-auth-submit-btn");

    if (descEl) {
        const actionText = options.actionLabel ? `「${options.actionLabel}」` : "この操作";
        descEl.textContent = `${actionText}を行うには会員ログインが必要です。ログイン後に入力内容を確認して送信できます。`;
    }
    if (statusEl) {
        statusEl.textContent = "";
        statusEl.style.display = "none";
    }
    if (form) {
        form.reset();
        // 新しい送信リスナーを設定
        form.onsubmit = async (e) => {
            e.preventDefault();
            const userId = form.userId.value.trim();
            const password = form.password.value;

            submitBtn.disabled = true;
            submitBtn.textContent = "認証中...";
            statusEl.style.display = "none";

            try {
                const { signInWithUserId } = await import("./firebase-init.js");
                const res = await signInWithUserId(userId, password);
                if (!res.ok) {
                    statusEl.textContent = res.message || "ユーザーIDまたはパスワードが正しくありません。";
                    statusEl.style.display = "block";
                    submitBtn.disabled = false;
                    submitBtn.textContent = "ログイン";
                    return;
                }

                // ログイン成功: モーダルを閉じる
                modal.classList.add("hidden");
                modal.style.display = "none";
                document.body.style.overflow = "";
                submitBtn.disabled = false;
                submitBtn.textContent = "ログイン";

                try {
                    window.dispatchEvent(new CustomEvent("app-auth-changed", { detail: res.profile }));
                } catch {}

                // 要件2: 元の画面・入力状態に復帰させ、自動送信せず手動確認を促す
                const btnName = options.buttonLabel || "登録";
                if (options.statusEl) {
                    options.statusEl.textContent = `✅ ログインしました（${res.profile?.name || "会員"}様）。内容を確認のうえ、もう一度【${btnName}】ボタンを押してください。`;
                    options.statusEl.style.color = "#247246";
                }

                // モーダルオープンなどの表示系操作の場合はコールバックを実行
                if (typeof options.onSuccess === "function") {
                    await options.onSuccess(res.profile);
                }
            } catch (authErr) {
                statusEl.textContent = authErr.message || "通信エラーが発生しました。";
                statusEl.style.display = "block";
                submitBtn.disabled = false;
                submitBtn.textContent = "ログイン";
            }
        };
    }

    modal.classList.remove("hidden");
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    const userIdInput = modal.querySelector('input[name="userId"]');
    if (userIdInput) userIdInput.focus();
}

let isPageInitialized = false;

async function safeInitializePage(page) {
    if (isPageInitialized) return;
    isPageInitialized = true;
    await initializePageContent(page);
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

    // 確定仕様: ホームページおよび公開ページは未ログインでも通常表示
    // 業務コンテンツを即時初期化（ゼロ待機・一般公開）
    await safeInitializePage(page);
});
