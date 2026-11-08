/**
 * 回覧板・資料室モジュール
 *
 * - Cloud Firestore (documents) からの動的メタデータ取得
 * - 年度別タブ切り替え & カテゴリ別分類 (回覧板 / 総会資料 / 会則 / 議事録 / 防災資料)
 * - 会員限定資料のアクセス制御 (未ログイン時は閲覧リンクをブロック)
 * - キーワード検索 (リアルタイム絞り込み)
 * - フォールバック機能 (config.drive のモックデータ)
 */

import { db, isFirebaseReady, auth, getCurrentUserProfile, signInWithUserId, signOutUser, onAuthStateChanged } from "./firebase-init.js";
import { showAuthModal } from "./main.js";
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Firestore または config から全資料メタデータを取得
 */
export async function fetchAllDocuments(config) {
    if (isFirebaseReady && db) {
        try {
            const docsRef = collection(db, "documents");
            const q = query(docsRef, orderBy("date", "desc"));
            const snap = await getDocs(q);
            const list = [];
            snap.forEach((docSnap) => {
                const data = docSnap.data();
                list.push({
                    id: docSnap.id,
                    title: data.title || "資料",
                    category: data.category || "その他資料",
                    year: String(data.year || (data.date ? data.date.slice(0, 4) : new Date().getFullYear())),
                    date: data.date || "",
                    url: data.fileUrl || data.url || "#",
                    isRestricted: Boolean(data.isRestricted)
                });
            });
            if (list.length > 0) return list;
        } catch (err) {
            console.warn("[Documents] Firestore 取得エラー (モックへフォールバック):", err);
        }
    }

    // フォールバック: config.js のモックデータをフラット化
    const circular = config?.drive?.mockCircular || {};
    const other = config?.drive?.mockDocuments || {};
    const list = [];

    Object.entries(circular).forEach(([year, items]) => {
        (items || []).forEach((item) => {
            list.push({
                title: item.title,
                category: "回覧板",
                year: String(year),
                date: item.date || `${year}-01-01`,
                url: item.url || "#",
                isRestricted: false
            });
        });
    });

    Object.entries(other).forEach(([cat, items]) => {
        (items || []).forEach((item) => {
            list.push({
                title: item.title,
                category: cat,
                year: "2026",
                date: "2026-05-01",
                url: item.url || "#",
                isRestricted: cat.includes("議事録") || cat.includes("総会") // 議事録などは限定想定
            });
        });
    });

    return list;
}

/** 年タブを生成 */
function createYearTabs(years, activeYear, onSelect) {
    const nav = document.createElement("nav");
    nav.className = "year-tabs";
    nav.setAttribute("aria-label", "年度を選択");

    years.forEach((year) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "year-tab" + (year === activeYear ? " active" : "");
        btn.textContent = `${year}年度`;
        btn.setAttribute("aria-pressed", String(year === activeYear));
        btn.addEventListener("click", () => {
            nav.querySelectorAll(".year-tab").forEach((b) => {
                b.classList.toggle("active", b === btn);
                b.setAttribute("aria-pressed", String(b === btn));
            });
            onSelect(year);
        });
        nav.appendChild(btn);
    });

    return nav;
}

/** PDFリストの描画（アクセス制御対応） */
function renderPdfList(container, items, isUserLoggedIn) {
    container.innerHTML = "";

    if (!items || items.length === 0) {
        container.innerHTML = "<p class='note'>このフォルダには資料がありません。</p>";
        return;
    }

    const list = document.createElement("ul");
    list.className = "simple-list";

    items.forEach((item) => {
        const li = document.createElement("li");
        li.dataset.docTitle = (item.title || "").toLowerCase();
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        li.style.padding = "8px 0";
        li.style.borderBottom = "1px solid #eee";

        const textSpan = document.createElement("span");

        // 会員限定資料のアクセス制御
        if (item.isRestricted && !isUserLoggedIn) {
            textSpan.innerHTML = `📄 <strong>${item.title}</strong> <span class="note" style="color:#c0392b;">(🔒 会員限定・ログインが必要です)</span>`;
            li.appendChild(textSpan);
        } else {
            const link = document.createElement("a");
            link.href = item.url || "#";
            link.textContent = `📄 ${item.title}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.style.fontWeight = "bold";
            textSpan.appendChild(link);

            if (item.date) {
                const dateSpan = document.createElement("span");
                dateSpan.className = "note";
                dateSpan.textContent = ` (${item.date})`;
                dateSpan.style.marginLeft = "8px";
                textSpan.appendChild(dateSpan);
            }
            li.appendChild(textSpan);

            if (item.url && item.url !== "#") {
                const viewBtn = document.createElement("a");
                viewBtn.href = item.url;
                viewBtn.target = "_blank";
                viewBtn.rel = "noopener noreferrer";
                viewBtn.className = "button-link";
                viewBtn.style.padding = "4px 10px";
                viewBtn.style.fontSize = "0.85rem";
                viewBtn.textContent = "開く";
                li.appendChild(viewBtn);
            }
        }

        list.appendChild(li);
    });

    container.appendChild(list);
}

/** 回覧板セクションの生成 */
function buildCircularSection(circularItems, isUserLoggedIn) {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.source = "circular";

    const h2 = document.createElement("h2");
    h2.textContent = "📋 回覧板";
    card.appendChild(h2);

    const yearGroups = {};
    circularItems.forEach((item) => {
        const y = item.year || "2026";
        if (!yearGroups[y]) yearGroups[y] = [];
        yearGroups[y].push(item);
    });

    const years = Object.keys(yearGroups).sort().reverse();
    if (years.length === 0) {
        card.innerHTML += "<p class='note'>現在、回覧板のデータはありません。</p>";
        return card;
    }

    const pdfContainer = document.createElement("div");
    pdfContainer.className = "pdf-list-container";

    const tabNav = createYearTabs(years, years[0], (year) => {
        renderPdfList(pdfContainer, yearGroups[year], isUserLoggedIn);
    });

    renderPdfList(pdfContainer, yearGroups[years[0]], isUserLoggedIn);
    card.append(tabNav, pdfContainer);
    return card;
}

/** その他資料（総会資料、会則、議事録、防災資料）セクションの生成 */
function buildOtherDocsSection(otherItems, isUserLoggedIn) {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.source = "other";

    const h2 = document.createElement("h2");
    h2.textContent = "📁 その他資料（総会資料・会則・議事録・防災）";
    card.appendChild(h2);

    const byCat = {};
    otherItems.forEach((item) => {
        const cat = item.category || "一般資料";
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push(item);
    });

    Object.entries(byCat).forEach(([category, items]) => {
        const h3 = document.createElement("h3");
        h3.textContent = category;
        h3.style.marginTop = "18px";
        h3.style.borderLeft = "4px solid #247246";
        h3.style.paddingLeft = "8px";

        const container = document.createElement("div");
        renderPdfList(container, items, isUserLoggedIn);
        card.append(h3, container);
    });

    return card;
}

function bindDocumentsFilters(root) {
    const sourceFilter = document.getElementById("docs-source-filter");
    const searchInput = document.getElementById("docs-search");
    const emptyState = document.getElementById("docs-empty");

    const applyFilters = () => {
        const selectedSource = sourceFilter?.value || "all";
        const keyword = (searchInput?.value || "").trim().toLowerCase();

        let visibleCards = 0;
        let visibleItems = 0;

        root.querySelectorAll(".card[data-source]").forEach((card) => {
            const source = card.dataset.source;
            const bySource = selectedSource === "all" || selectedSource === source;

            if (!bySource) {
                card.classList.add("hidden");
                return;
            }

            let itemCount = 0;
            card.querySelectorAll("li[data-doc-title]").forEach((li) => {
                const match = keyword === "" || (li.dataset.docTitle || "").includes(keyword);
                li.classList.toggle("hidden", !match);
                if (match) itemCount++;
            });

            const visible = itemCount > 0 || card.querySelectorAll("li[data-doc-title]").length === 0;
            card.classList.toggle("hidden", !visible);
            if (visible) visibleCards++;
            visibleItems += itemCount;
        });

        if (emptyState) {
            const hasResult = visibleCards > 0 && (keyword === "" || visibleItems > 0);
            emptyState.classList.toggle("hidden", hasResult);
        }
    };

    sourceFilter?.addEventListener("change", applyFilters);
    searchInput?.addEventListener("input", applyFilters);
}

/**
 * 未ログイン時のログイン画面を描画する
 */
function renderDocumentsLoginGate(root, onLoggedIn) {
    const filterSection = document.getElementById("docs-filter-section");
    if (filterSection) {
        filterSection.classList.add("hidden");
    }

    root.innerHTML = `
        <section class="card" style="max-width:520px; margin:20px auto; border:2px solid #247246; padding:24px;">
            <div style="text-align:center; margin-bottom:18px;">
                <span style="font-size:2.4rem;">🔒</span>
                <h2 style="margin:8px 0; color:#1a365d;">回覧板・資料室 会員ログイン</h2>
                <p class="note" style="margin-top:6px; line-height:1.6;">
                    回覧板および町内会資料は、個人情報・地域情報保護のため<strong>若松町内会員専用</strong>となっております。<br>
                    閲覧には町内会員（合言葉）または管理者アカウントでのログインが必要です。
                </p>
            </div>

            <form id="docs-login-form" class="inline-form" style="display:flex; flex-direction:column; gap:14px;">
                <label style="font-size:0.9rem; font-weight:600;">ユーザーID
                    <input name="userId" type="text" autocomplete="username" placeholder="例: member, officer, niina" required autofocus style="width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:4px;">
                </label>
                <label style="font-size:0.9rem; font-weight:600;">パスワード（または合言葉）
                    <input name="password" type="password" autocomplete="current-password" placeholder="パスワード（または町内会報記載の合言葉）" required style="width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:4px;">
                </label>
                <div class="button-row" style="margin-top:6px;">
                    <button class="button" type="submit" id="docs-login-submit-btn" style="width:100%; padding:10px; font-size:1rem; font-weight:bold;">ログインして資料を閲覧</button>
                </div>
                <p id="docs-login-status" class="note" aria-live="polite" style="margin-top:6px; color:#c0392b; display:none;"></p>
                <div class="note" style="margin-top:10px; font-size:0.85rem; line-height:1.6; background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
                    ・ <strong>一般会員の方</strong>: ユーザーID「<code>member</code>」、パスワードに「町内会報記載の合言葉」を入力してください。<br>
                    ・ <strong>役員・管理者</strong>: 割り当てられた個別ID（<code>officer</code>, <code>niina</code>等）でログインしてください。<br>
                    ・ 合言葉がご不明な場合は、各組長・役員までお問い合わせください。
                </div>
            </form>
        </section>
    `;

    const form = root.querySelector("#docs-login-form");
    const statusEl = root.querySelector("#docs-login-status");
    const submitBtn = root.querySelector("#docs-login-submit-btn");

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const userId = form.userId.value.trim();
            const password = form.password.value;

            submitBtn.disabled = true;
            submitBtn.textContent = "認証中...";
            statusEl.style.display = "none";

            try {
                const res = await signInWithUserId(userId, password);
                if (!res.ok) {
                    statusEl.textContent = res.message || "ユーザーIDまたはパスワードが正しくありません。";
                    statusEl.style.display = "block";
                    submitBtn.disabled = false;
                    submitBtn.textContent = "ログインして資料を閲覧";
                    return;
                }

                // 認証成功
                if (typeof onLoggedIn === "function") {
                    await onLoggedIn(res.profile);
                }
            } catch (err) {
                statusEl.textContent = err.message || "通信エラーが発生しました。";
                statusEl.style.display = "block";
                submitBtn.disabled = false;
                submitBtn.textContent = "ログインして資料を閲覧";
            }
        });
    }
}

/** 資料室ページの初期化 */
export async function initDocumentsPage(config = {}) {
    const root = document.getElementById("documents-root");
    if (!root) return;

    const filterSection = document.getElementById("docs-filter-section");

    // ログイン状態に応じた表示の描画関数
    const renderContent = async () => {
        root.innerHTML = "<p class='note'>資料室の利用権限を確認しています...</p>";

        if (!auth?.currentUser) {
            renderDocumentsLoginGate(root, async () => {
                await renderContent();
            });
            return;
        }

        const profile = await getCurrentUserProfile();
        if (!profile || !profile.isMember) {
            renderDocumentsLoginGate(root, async () => {
                await renderContent();
            });
            return;
        }

        // ログイン済み（会員・役員・管理者）
        if (filterSection) {
            filterSection.classList.remove("hidden");
        }

        root.innerHTML = "<p class='note'>資料一覧を読み込み中です...</p>";
        const allDocs = await fetchAllDocuments(config);

        const circularItems = allDocs.filter((d) => d.category === "回覧板");
        const otherItems = allDocs.filter((d) => d.category !== "回覧板");

        root.innerHTML = "";

        // ログイン状態ヘッダーバー
        const authBar = document.createElement("div");
        authBar.className = "card sub-card auth-status-bar";
        authBar.style.display = "flex";
        authBar.style.flexWrap = "wrap";
        authBar.style.justifyContent = "space-between";
        authBar.style.alignItems = "center";
        authBar.style.gap = "10px";
        authBar.style.marginBottom = "16px";
        authBar.style.background = "#f0fdf4";
        authBar.style.borderColor = "#86efac";

        const roleLabel = profile.isAdmin ? "管理者" : (profile.isOfficer ? "役員" : "一般会員");
        const userDesc = document.createElement("div");
        userDesc.innerHTML = `<span>👤 <strong>${profile.name || "会員"}様</strong>（${roleLabel}）としてログイン中</span>`;

        const actionGroup = document.createElement("div");
        actionGroup.style.display = "flex";
        actionGroup.style.gap = "8px";
        actionGroup.style.alignItems = "center";

        if (profile.isOfficer) {
            const adminLink = document.createElement("a");
            adminLink.href = "admin.html";
            adminLink.className = "button-link";
            adminLink.style.padding = "4px 10px";
            adminLink.style.fontSize = "0.85rem";
            adminLink.style.background = "#1a365d";
            adminLink.textContent = "📂 資料管理（管理ページ）";
            actionGroup.appendChild(adminLink);
        }

        const logoutBtn = document.createElement("button");
        logoutBtn.type = "button";
        logoutBtn.className = "button";
        logoutBtn.style.padding = "4px 10px";
        logoutBtn.style.fontSize = "0.85rem";
        logoutBtn.style.background = "#64748b";
        logoutBtn.textContent = "ログアウト";
        logoutBtn.addEventListener("click", async () => {
            await signOutUser();
            await renderContent();
        });
        actionGroup.appendChild(logoutBtn);

        authBar.append(userDesc, actionGroup);
        root.appendChild(authBar);

        // 資料セクション描画
        root.appendChild(buildCircularSection(circularItems, true));
        if (otherItems.length > 0) {
            root.appendChild(buildOtherDocsSection(otherItems, true));
        }

        bindDocumentsFilters(root);
    };

    // 初回描画
    await renderContent();

    // 外部からの認証状態変更イベントまたは onAuthStateChanged を監視
    if (auth) {
        onAuthStateChanged(auth, async () => {
            await renderContent();
        });
    }
    window.addEventListener("app-auth-changed", async () => {
        await renderContent();
    });
}
