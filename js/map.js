/**
 * 地域マップモジュール
 *
 * Google My Maps を iframe 埋め込みで表示します。
 * スポット一覧はカテゴリ別にグループ化して表示します。
 *
 * 将来の独自マップ対応: renderMapEmbed() を別コンポーネントへ置き換えるだけで移行できます。
 */

/** Google My Maps を iframe で描画します。 */
export function renderMapEmbed(containerId, mapUrl) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const iframe = document.createElement("iframe");
    iframe.className = "embed-frame map-frame";
    iframe.src = mapUrl;
    iframe.title = "若松町内会 地域マップ";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";

    container.appendChild(iframe);
}

    function renderLocalImageMap(containerId, imageUrl, spots, fallbackMapUrl) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = "";

        const wrap = document.createElement("div");
        wrap.className = "local-map-wrap";

        const image = document.createElement("img");
        image.className = "local-map-image";
        image.alt = "若松町周辺の地域マップ";
        image.src = imageUrl;

        const markersLayer = document.createElement("div");
        markersLayer.className = "local-map-markers";

        spots.forEach((spot) => {
            if (typeof spot.x !== "number" || typeof spot.y !== "number") {
                return;
            }
            const marker = document.createElement("button");
            marker.type = "button";
            marker.className = "local-map-marker";
            marker.style.left = `${spot.x}%`;
            marker.style.top = `${spot.y}%`;
            marker.title = `${spot.category}: ${spot.name}`;
            marker.textContent = "●";
            markersLayer.appendChild(marker);
        });

        image.addEventListener("error", () => {
            renderMapEmbed(containerId, fallbackMapUrl);
        });

        wrap.append(image, markersLayer);
        container.appendChild(wrap);
    }

/** カテゴリ別スポットをグループ化して表示します。 */
function renderSpotsByCategory(root, spots) {
    root.innerHTML = "";

    // カテゴリ別に分類
    const byCategory = {};
    spots.forEach((spot) => {
        const cat  = typeof spot === "string" ? "その他" : (spot.category || "その他");
        const name = typeof spot === "string" ? spot      : spot.name;
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(name);
    });

    const CATEGORY_ICONS = {
        "集会所":   "🏠",
        "避難所":   "🏫",
        "AED":      "❤️",
        "防災倉庫": "📦",
        "その他":   "📍"
    };

    Object.entries(byCategory).forEach(([category, names]) => {
        const row = document.createElement("div");
        row.className = "spot-category";

        const label = document.createElement("span");
        label.className = "spot-category-label";
        label.textContent = `${CATEGORY_ICONS[category] ?? "📍"} ${category}`;

        row.appendChild(label);

        names.forEach((name) => {
            const pill = document.createElement("span");
            pill.className = "pill-item";
            pill.textContent = name;
            row.appendChild(pill);
        });

        root.appendChild(row);
    });
}

/** 地域マップページを初期化します。 */
export function initMapPage(config) {
    const mapUrl = config?.map?.myMapsUrl || "about:blank";
    const localImageUrl = config?.map?.localImageUrl;
    const spots = config?.map?.spots || [];

    if (localImageUrl) {
        renderLocalImageMap("map-embed", localImageUrl, spots, mapUrl);
    } else {
        renderMapEmbed("map-embed", mapUrl);
    }

    const spotsRoot = document.getElementById("map-spots");
    if (!spotsRoot) return;

    const allSpots = (config?.map?.spots || []).map((spot) => {
        if (typeof spot === "string") {
            return { name: spot, category: "その他" };
        }
        return { name: spot.name || "", category: spot.category || "その他" };
    });

    const categoryFilter = document.getElementById("map-category-filter");
    const searchInput = document.getElementById("map-search");
    const emptyState = document.getElementById("map-empty");

    if (categoryFilter) {
        const categories = Array.from(new Set(allSpots.map((spot) => spot.category)));
        categories.forEach((category) => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        });
    }

    const applyFilters = () => {
        const selectedCategory = categoryFilter?.value || "all";
        const keyword = (searchInput?.value || "").trim().toLowerCase();

        const filtered = allSpots.filter((spot) => {
            const byCategory = selectedCategory === "all" || spot.category === selectedCategory;
            const byKeyword = keyword === "" || spot.name.toLowerCase().includes(keyword);
            return byCategory && byKeyword;
        });

        renderSpotsByCategory(spotsRoot, filtered);
        if (emptyState) {
            emptyState.classList.toggle("hidden", filtered.length > 0);
        }
    };

    categoryFilter?.addEventListener("change", applyFilters);
    searchInput?.addEventListener("input", applyFilters);
    applyFilters();

    renderWalkingCourses("walking-courses");
}

const WALKING_COURSES = [
    {
        id: "course-1",
        title: "🌸 ふれあい公園・平坦ルート",
        distance: "約 1.2 km",
        time: "約 20 分",
        badge: "車椅子・ベビーカー推奨",
        description: "若松集会所から若松中央公園をのんびり往復する平坦で安全な歩道ルートです。休憩ベンチや多目的トイレもあります。",
        highlights: ["集会所", "若松中央公園", "ふれあい花壇"]
    },
    {
        id: "course-2",
        title: "🌿 歴史と緑の健康散策コース",
        distance: "約 2.5 km",
        time: "約 40 分",
        badge: "適度な運動・木陰あり",
        description: "町内の鎮守の杜や並木道をめぐるウォーキングコース。春は桜、秋は紅葉が楽しめます。",
        highlights: ["若松神社", "緑道並木", "中央公園（給水スポット）"]
    },
    {
        id: "course-3",
        title: "🛡️ 安心・防災確認ルート",
        distance: "約 1.8 km",
        time: "約 30 分",
        badge: "家族で歩く避難路",
        description: "一時避難場所やAED設置場所、防災倉庫を確認しながら歩ける防災学習コースです。",
        highlights: ["AED（集会所内）", "防災倉庫", "若松小学校（第1避難所）"]
    }
];

function renderWalkingCourses(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";
    WALKING_COURSES.forEach((course) => {
        const card = document.createElement("article");
        card.className = "card sub-card walking-card";
        card.style.border = "1px solid #e0ded8";
        card.style.background = "#fff";
        card.style.padding = "14px";
        card.style.borderRadius = "8px";

        card.innerHTML = `
            <span class="status-badge" style="background:#eaf2ec;color:#247246;font-size:0.8rem;padding:3px 8px;border-radius:4px;font-weight:bold;">${course.badge}</span>
            <h3 style="margin:8px 0 6px;color:#2c3e50;">${course.title}</h3>
            <p style="margin:0 0 8px;font-weight:bold;color:#555;">
                📏 距離: ${course.distance} ｜ ⏱️ 所要目安: ${course.time}
            </p>
            <p style="margin:0 0 10px;font-size:0.95rem;line-height:1.5;">${course.description}</p>
            <div style="font-size:0.85rem;color:#777;">
                <strong>📍 主な見どころ・目印:</strong> ${course.highlights.join(" → ")}
            </div>
        `;
        container.appendChild(card);
    });
}
