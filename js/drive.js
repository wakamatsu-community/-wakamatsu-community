/**
 * 回覧板・資料室モジュール
 *
 * - Cloud Firestore (documents) からの動的メタデータ取得
 * - 年度別タブ切り替え & カテゴリ別分類 (回覧板 / 総会資料 / 会則 / 議事録 / 防災資料)
 * - 会員限定資料のアクセス制御 (未ログイン時は閲覧リンクをブロック)
 * - キーワード検索 (リアルタイム絞り込み)
 * - フォールバック機能 (config.drive のモックデータ)
 */

import { db, isFirebaseReady, auth } from "./firebase-init.js";
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

/** 資料室ページの初期化 */
export async function initDocumentsPage(config = {}) {
    const root = document.getElementById("documents-root");
    if (!root) return;

    root.innerHTML = "<p class='note'>資料一覧を読み込み中です...</p>";

    const isUserLoggedIn = Boolean(auth?.currentUser);
    const allDocs = await fetchAllDocuments(config);

    const circularItems = allDocs.filter((d) => d.category === "回覧板");
    const otherItems = allDocs.filter((d) => d.category !== "回覧板");

    root.innerHTML = "";
    root.appendChild(buildCircularSection(circularItems, isUserLoggedIn));
    if (otherItems.length > 0) {
        root.appendChild(buildOtherDocsSection(otherItems, isUserLoggedIn));
    }

    bindDocumentsFilters(root);
}
