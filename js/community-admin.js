const EVENTS_STORE_KEY = "wakamatsu_managed_events_v1";
const EVENT_CATEGORIES_STORE_KEY = "wakamatsu_event_categories_v1";

function isConfigured(url) {
    return Boolean(url && !url.includes("sample-"));
}

function parseGvizJson(text) {
    const jsonText = text.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, "");
    return JSON.parse(jsonText);
}

async function fetchSheetRows(url) {
    if (!isConfigured(url)) {
        return null;
    }
    try {
        const res = await fetch(url);
        const data = parseGvizJson(await res.text());
        return data?.table?.rows || [];
    } catch {
        return null;
    }
}

async function postToEndpoint(endpoint, payload) {
    if (!isConfigured(endpoint)) {
        return false;
    }
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function postFormToEndpoint(endpoint, formData) {
    if (!isConfigured(endpoint)) {
        return false;
    }
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            body: formData
        });
        return res.ok;
    } catch {
        return false;
    }
}

function loadLocalEvents(config) {
    const saved = localStorage.getItem(EVENTS_STORE_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch {
            localStorage.removeItem(EVENTS_STORE_KEY);
        }
    }
    const mock = config?.calendar?.mockManagedEvents || [];
    localStorage.setItem(EVENTS_STORE_KEY, JSON.stringify(mock));
    return mock;
}

function saveLocalEvents(events) {
    localStorage.setItem(EVENTS_STORE_KEY, JSON.stringify(events));
}

function loadLocalCategories(config) {
    const saved = localStorage.getItem(EVENT_CATEGORIES_STORE_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch {
            localStorage.removeItem(EVENT_CATEGORIES_STORE_KEY);
        }
    }
    const mock = config?.calendar?.mockCategories || [];
    localStorage.setItem(EVENT_CATEGORIES_STORE_KEY, JSON.stringify(mock));
    return mock;
}

function saveLocalCategories(categories) {
    localStorage.setItem(EVENT_CATEGORIES_STORE_KEY, JSON.stringify(categories));
}

async function loadManagedEvents(config) {
    const rows = await fetchSheetRows(config?.calendar?.management?.eventsSheetUrl);
    if (!rows) {
        return loadLocalEvents(config);
    }

    const parsed = rows
        .map((row) => {
            const c = row.c || [];
            return {
                id: String(c[0]?.v || ""),
                type: String(c[1]?.v || "special"),
                title: String(c[2]?.v || ""),
                category: String(c[3]?.v || ""),
                scheduleLabel: String(c[4]?.v || ""),
                place: String(c[5]?.v || ""),
                description: String(c[6]?.v || ""),
                recruitFormUrl: String(c[7]?.v || "")
            };
        })
        .filter((event) => event.title);

    return parsed.length > 0 ? parsed : loadLocalEvents(config);
}

export async function loadAllManagedEvents(config) {
    return loadManagedEvents(config);
}

async function loadEventCategories(config, events) {
    const rows = await fetchSheetRows(config?.calendar?.management?.categoriesSheetUrl);
    if (rows && rows.length > 0) {
        const parsed = rows
            .map((row) => String((row.c || [])[0]?.v || "").trim())
            .filter(Boolean);
        if (parsed.length > 0) {
            return Array.from(new Set(parsed));
        }
    }

    const local = loadLocalCategories(config);
    const fromEvents = events.map((event) => event.category).filter(Boolean);
    return Array.from(new Set([...local, ...fromEvents]));
}

function createManagedEventCard(event) {
    const card = document.createElement("article");
    card.className = "card managed-event-card";
    card.dataset.type = event.type;
    card.dataset.category = event.category || "";
    card.dataset.search = `${event.title} ${event.category} ${event.place}`.toLowerCase();

    const tag = event.type === "recurring" ? "定例行事" : "追加イベント";

    card.innerHTML = `
        <p class="note">${tag}</p>
        <h3>${event.title}</h3>
        <p><strong>カテゴリ:</strong> ${event.category || "未設定"}</p>
        <p><strong>日時:</strong> ${event.scheduleLabel || "未設定"}</p>
        <p><strong>場所:</strong> ${event.place || "未設定"}</p>
        <p>${event.description || ""}</p>
    `;

    if (event.recruitFormUrl) {
        const link = document.createElement("a");
        link.className = "button-link";
        link.href = event.recruitFormUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "参加募集フォーム";
        card.appendChild(link);
    }

    return card;
}

function isLearningEvent(event) {
    const text = `${event?.category || ""} ${event?.title || ""}`.toLowerCase();
    return text.includes("学び")
        || text.includes("コミニティ")
        || text.includes("コミュニティ")
        || text.includes("コミュニティー")
        || text.includes("community");
}

function getLearningCategories(events) {
    return Array.from(new Set(events.map((event) => event.category).filter(Boolean)));
}

function createLearningEventCard(event) {
    const card = document.createElement("article");
    card.className = "card managed-event-card learning-event-card";
    card.dataset.type = event.type;
    card.dataset.category = event.category || "";
    card.dataset.search = `${event.title} ${event.category} ${event.place} ${event.description}`.toLowerCase();
    card.dataset.eventId = event.id;

    const typeLabel = event.type === "recurring" ? "定例開催" : "単発開催";

    card.innerHTML = `
        <p class="note">${typeLabel}</p>
        <h3>${event.title}</h3>
        <p><strong>開催日:</strong> ${event.scheduleLabel || "未設定"}</p>
        <p><strong>会場:</strong> ${event.place || "未設定"}</p>
        <p>${event.description || "詳細はコミニティカレンダーをご確認ください。"}</p>
        ${event.type === "special"
        ? '<button class="button" type="button" data-action="select-learning-event">この開催日に参加登録</button>'
        : ""}
    `;

    return card;
}

function applyEventFilters() {
    const typeFilter = document.getElementById("managed-event-type-filter");
    const categoryFilter = document.getElementById("learning-category-filter");
    const searchInput = document.getElementById("managed-event-search");
    const empty = document.getElementById("managed-events-empty");
    const cards = document.querySelectorAll(".managed-event-card");

    if (!cards.length) {
        return;
    }

    const selectedType = typeFilter?.value || "all";
    const selectedCategory = categoryFilter?.value || "all";
    const keyword = (searchInput?.value || "").trim().toLowerCase();

    let visible = 0;
    cards.forEach((card) => {
        const byType = selectedType === "all" || card.dataset.type === selectedType;
        const byCategory = selectedCategory === "all" || card.dataset.category === selectedCategory;
        const byKeyword = keyword === "" || (card.dataset.search || "").includes(keyword);
        const show = byType && byCategory && byKeyword;
        card.classList.toggle("hidden", !show);
        if (show) {
            visible += 1;
        }
    });

    empty?.classList.toggle("hidden", visible > 0);
}

function applyEventsSheetLink(config) {
    const eventsLink = document.getElementById("admin-events-sheet-link");
    const categoryLink = document.getElementById("admin-event-categories-sheet-link");

    if (eventsLink) {
        eventsLink.href = config?.calendar?.management?.eventsEditUrl || "#";
        eventsLink.classList.toggle("disabled-link", eventsLink.href === "#");
    }

    if (categoryLink) {
        categoryLink.href = config?.calendar?.management?.categoriesEditUrl || "#";
        categoryLink.classList.toggle("disabled-link", categoryLink.href === "#");
    }
}

function applyAdminDataLinks(config) {
    const peopleLink = document.getElementById("admin-people-sheet-link");
    const ledgerLink = document.getElementById("admin-equipment-ledger-sheet-link");
    const circularDriveLink = document.getElementById("admin-circular-drive-link");
    const docsDriveLink = document.getElementById("admin-docs-drive-link");

    if (peopleLink) {
        peopleLink.href = config?.adminData?.people?.editUrl || "#";
        peopleLink.classList.toggle("disabled-link", peopleLink.href === "#");
    }
    if (ledgerLink) {
        ledgerLink.href = config?.adminData?.equipmentLedger?.editUrl || "#";
        ledgerLink.classList.toggle("disabled-link", ledgerLink.href === "#");
    }
    if (circularDriveLink) {
        circularDriveLink.href = config?.drive?.circularFolderUrl || "#";
        circularDriveLink.classList.toggle("disabled-link", circularDriveLink.href === "#");
    }
    if (docsDriveLink) {
        docsDriveLink.href = config?.drive?.documentsFolderUrl || "#";
        docsDriveLink.classList.toggle("disabled-link", docsDriveLink.href === "#");
    }
}

function populateEventSelect(select, events) {
    if (!select) {
        return;
    }
    select.innerHTML = "";
    events.forEach((event) => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = `${event.title} (${event.scheduleLabel || "日時未設定"})`;
        select.appendChild(option);
    });
}

function bindRecruitForm(config, events) {
    const form = document.getElementById("event-recruit-form");
    const select = document.getElementById("recruit-event-id");
    const status = document.getElementById("event-recruit-status");

    if (!form || !select || !status) {
        return;
    }

    populateEventSelect(select, events);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = {
            type: "eventRecruit",
            eventId: String(fd.get("eventId") || ""),
            name: String(fd.get("name") || "").trim(),
            phone: String(fd.get("phone") || "").trim(),
            group: String(fd.get("group") || "").trim(),
            count: Number(fd.get("count") || 1),
            createdAt: new Date().toISOString()
        };

        const ok = await postToEndpoint(config?.calendar?.management?.recruitSubmitEndpoint, payload);
        status.textContent = ok
            ? "参加希望を送信しました。"
            : "参加希望を記録しました（Apps Script未設定のためローカル処理）。";
        const selectedEventId = select.value;
        form.reset();
        if (select.options.length > 0) {
            const keepOption = Array.from(select.options).some((option) => option.value === selectedEventId);
            if (keepOption) {
                select.value = selectedEventId;
            } else {
                select.selectedIndex = 0;
            }
        }
    });
}

function openRecruitModal() {
    const modal = document.getElementById("event-recruit-modal");
    if (!modal) {
        return;
    }
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function closeRecruitModal() {
    const modal = document.getElementById("event-recruit-modal");
    if (!modal) {
        return;
    }
    modal.classList.add("hidden");
    document.body.style.overflow = "";
}

function bindRecruitModalActions() {
    const modal = document.getElementById("event-recruit-modal");
    const form = document.getElementById("event-recruit-form");
    const cancelButton = document.getElementById("event-recruit-cancel");
    const closeButton = document.getElementById("event-recruit-close");
    const status = document.getElementById("event-recruit-status");
    const select = document.getElementById("recruit-event-id");

    if (!(modal && form && cancelButton && closeButton && status && select)) {
        return;
    }

    cancelButton.addEventListener("click", () => {
        const selectedEventId = select.value;
        form.reset();
        status.textContent = "入力内容をクリアしました。";
        if (Array.from(select.options).some((option) => option.value === selectedEventId)) {
            select.value = selectedEventId;
        }
    });

    closeButton.addEventListener("click", () => {
        closeRecruitModal();
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeRecruitModal();
        }
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.classList.contains("hidden")) {
            closeRecruitModal();
        }
    });
}

function bindAttendanceForm(config, events) {
    const form = document.getElementById("event-attendance-form");
    const select = document.getElementById("attendance-event-id");
    const status = document.getElementById("event-attendance-status");

    if (!form || !select || !status) {
        return;
    }

    populateEventSelect(select, events);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = {
            type: "eventAttendance",
            eventId: String(fd.get("eventId") || ""),
            memberName: String(fd.get("memberName") || "").trim(),
            result: String(fd.get("result") || ""),
            memo: String(fd.get("memo") || "").trim(),
            createdAt: new Date().toISOString()
        };

        if (!payload.memberName || !payload.result) {
            status.textContent = "メンバー名と参加結果を入力してください。";
            return;
        }

        const ok = await postToEndpoint(config?.calendar?.management?.attendanceSubmitEndpoint, payload);
        status.textContent = ok
            ? "参加結果を記録しました。"
            : "参加結果を記録しました（Apps Script未設定のためローカル処理）。";
        form.reset();
        if (select.options.length > 0) {
            select.selectedIndex = 0;
        }
    });
}

async function handleEventFormSubmit(form, statusEl, type, config) {
    const fd = new FormData(form);
    const event = {
        id: `EV-${Date.now()}`,
        type,
        title: String(fd.get("title") || "").trim(),
        category: String(fd.get("category") || "").trim(),
        scheduleLabel: String(fd.get("scheduleLabel") || "").trim(),
        place: String(fd.get("place") || "").trim(),
        recruitFormUrl: String(fd.get("recruitFormUrl") || "").trim(),
        description: String(fd.get("description") || "").trim()
    };

    if (!event.title || !event.category || !event.scheduleLabel || !event.place || !event.recruitFormUrl) {
        statusEl.textContent = "必須項目を入力してください。";
        return;
    }

    const posted = await postToEndpoint(config?.calendar?.management?.submitEndpoint, {
        type: "managedEvent",
        event
    });

    const local = loadLocalEvents(config);
    saveLocalEvents([...local, event]);

    statusEl.textContent = posted
        ? "Google連携でイベント登録しました。"
        : "イベント登録しました（Apps Script未設定のためローカル保存）。";
    form.reset();
}

function bindSimpleAdminForm(formId, statusId, endpoint, kind) {
    const form = document.getElementById(formId);
    const status = document.getElementById(statusId);
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = {
            type: kind,
            data: Object.fromEntries(fd.entries()),
            createdAt: new Date().toISOString()
        };

        const posted = await postToEndpoint(endpoint, payload);
        status.textContent = posted
            ? "Google連携で登録しました。"
            : "登録しました（Apps Script未設定のためローカル処理）。";
        form.reset();
    });
}

function bindCategoryForm(config) {
    const form = document.getElementById("admin-event-category-form");
    const status = document.getElementById("admin-event-category-status");
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const categoryName = String(fd.get("categoryName") || "").trim();

        if (!categoryName) {
            status.textContent = "カテゴリ名を入力してください。";
            return;
        }

        const posted = await postToEndpoint(config?.calendar?.management?.categorySubmitEndpoint, {
            type: "eventCategory",
            categoryName,
            createdAt: new Date().toISOString()
        });

        const local = loadLocalCategories(config);
        if (!local.includes(categoryName)) {
            saveLocalCategories([...local, categoryName]);
        }

        status.textContent = posted
            ? "カテゴリをGoogle連携で登録しました。"
            : "カテゴリを登録しました（Apps Script未設定のためローカル保存）。";
        form.reset();
    });
}

function bindDriveDocUploadForm(config) {
    const form = document.getElementById("admin-drive-doc-upload-form");
    const status = document.getElementById("admin-drive-doc-upload-status");
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const files = fd.getAll("files").filter((file) => file instanceof File && file.size > 0);
        if (files.length === 0) {
            status.textContent = "PDFファイルを選択してください。";
            return;
        }

        const upload = new FormData();
        upload.append("action", "uploadDocuments");
        upload.append("destination", String(fd.get("destination") || ""));
        upload.append("category", String(fd.get("category") || ""));
        upload.append("title", String(fd.get("title") || ""));
        files.forEach((file) => upload.append("files", file));

        const ok = await postFormToEndpoint(config?.drive?.uploadEndpoint, upload);
        status.textContent = ok
            ? "Google Driveへ資料を保存しました。"
            : "資料保存に失敗しました（Apps Script設定を確認）。";
        if (ok) {
            form.reset();
        }
    });
}

function fillManagedEventCategoryFilter(categories) {
    const select = document.getElementById("learning-category-filter");
    if (!select) {
        return;
    }
    const current = select.value;
    select.innerHTML = "<option value=\"all\">すべて</option>";
    categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });
    if (current && Array.from(select.options).some((opt) => opt.value === current)) {
        select.value = current;
    }
}

function bindLearningEventSelection(events) {
    const list = document.getElementById("managed-events-list");
    const select = document.getElementById("recruit-event-id");
    const form = document.getElementById("event-recruit-form");
    const status = document.getElementById("event-recruit-status");

    if (!list || !select || !form || !status) {
        return;
    }

    list.addEventListener("click", (event) => {
        const button = event.target.closest('[data-action="select-learning-event"]');
        if (!button) {
            return;
        }

        const card = button.closest(".learning-event-card");
        const eventId = card?.dataset.eventId;
        if (!eventId) {
            return;
        }

        const matched = events.find((item) => item.id === eventId);
        if (!matched) {
            return;
        }

        select.value = matched.id;
        status.textContent = "";
        openRecruitModal();
        const nameInput = form.querySelector('input[name="name"]');
        if (nameInput instanceof HTMLElement) {
            nameInput.focus();
        }
    });
}

export async function initManagedEventsPage(config) {
    const list = document.getElementById("managed-events-list");
    if (!list) {
        return;
    }

    const loadedEvents = await loadManagedEvents(config);
    const events = loadedEvents.filter(isLearningEvent);
    const displayEvents = events.length > 0 ? events : loadedEvents;
    await loadEventCategories(config, events);
    const categories = getLearningCategories(displayEvents);

    list.innerHTML = "";
    displayEvents.forEach((event) => {
        list.appendChild(createLearningEventCard(event));
    });

    fillManagedEventCategoryFilter(categories);

    const typeFilter = document.getElementById("managed-event-type-filter");
    const categoryFilter = document.getElementById("learning-category-filter");
    const search = document.getElementById("managed-event-search");
    typeFilter?.addEventListener("change", applyEventFilters);
    categoryFilter?.addEventListener("change", applyEventFilters);
    search?.addEventListener("input", applyEventFilters);
    applyEventFilters();

    bindRecruitForm(config, displayEvents);
    bindRecruitModalActions();
    bindLearningEventSelection(displayEvents);
}

export function initAdminCommunityForms(config) {
    applyEventsSheetLink(config);
    applyAdminDataLinks(config);

    const recurringForm = document.getElementById("admin-recurring-event-form");
    const recurringStatus = document.getElementById("admin-recurring-event-status");
    const specialForm = document.getElementById("admin-special-event-form");
    const specialStatus = document.getElementById("admin-special-event-status");

    if (recurringForm && recurringStatus) {
        recurringForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleEventFormSubmit(recurringForm, recurringStatus, "recurring", config);
        });
    }

    if (specialForm && specialStatus) {
        specialForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleEventFormSubmit(specialForm, specialStatus, "special", config);
        });
    }

    bindCategoryForm(config);
    bindDriveDocUploadForm(config);

    bindSimpleAdminForm(
        "admin-people-form",
        "admin-people-status",
        config?.adminData?.people?.submitEndpoint,
        "peopleLedger"
    );

    bindSimpleAdminForm(
        "admin-equipment-ledger-form",
        "admin-equipment-ledger-status",
        config?.adminData?.equipmentLedger?.submitEndpoint,
        "equipmentLedger"
    );
}
