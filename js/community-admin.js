import { gasGet, gasPost, getGasUrl } from "./gas-api.js";

const EVENTS_STORE_KEY = "wakamatsu_managed_events_v1";

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

async function postToGas(payload) {
    const url = getGasUrl();
    try {
        const action = String(payload?.action || "").trim();
        const response = action === "login"
            ? await gasGet(payload)
            : await gasPost(payload);
        const hasBusinessError = response && (
            response.ok === false
            || response.success === false
            || response.result === false
            || response.isError === true
            || Boolean(response.error)
        );

        if (hasBusinessError) {
            const errorMessage = String(response?.error || response?.message || "GASから失敗応答が返されました。");
            return {
                ok: false,
                status: Number(response?._httpStatus || 200),
                url: String(response?._requestUrl || url),
                error: errorMessage,
                response
            };
        }

        return {
            ok: true,
            status: Number(response?._httpStatus || 200),
            url: String(response?._requestUrl || url),
            error: "",
            response
        };
    } catch (error) {
        const message = String(error && error.message || error);
        const statusMatch = message.match(/(\d{3})/);
        return {
            ok: false,
            status: statusMatch ? Number(statusMatch[1]) : 0,
            url,
            error: message,
            response: null
        };
    }
}

function stringifyPayloadForDebug(payload) {
    try {
        const json = JSON.stringify(payload);
        return json.length > 400 ? `${json.slice(0, 400)}...` : json;
    } catch {
        return "<payload stringify failed>";
    }
}

function buildDebugStatus(action, payload, result) {
    const payloadText = stringifyPayloadForDebug(payload);
    if (result.ok) {
        return `送信成功: action=${action}, URL=${result.url}, payload=${payloadText}, HTTP=${result.status}`;
    }

    return `【通信失敗】URL: ${result.url || getGasUrl()} | エラー内容: HTTP=${result.status || "N/A"} / ${result.error || "不明なエラー"}`;
}

function setStatusText(statusEl, text, isError = false) {
    if (!statusEl) {
        return;
    }
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#c62828" : "";
    statusEl.style.fontWeight = isError ? "700" : "";
}

function setCommFailureStatus(statusEl, result) {
    const text = `【通信失敗】URL: ${result?.url || getGasUrl()} | エラー内容: HTTP=${result?.status || "N/A"} / ${result?.error || "不明なエラー"}`;
    setStatusText(statusEl, text, true);
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
        link.textContent = "参加登録フォーム";
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

function parseScheduleLabelToCalendarEvent(event) {
    const explicitStart = String(event?.start || "");
    const explicitEnd = String(event?.end || "");
    let start = explicitStart;
    let end = explicitEnd;
    let allDay = !String(explicitStart).includes("T");

    if (!start) {
        const label = String(event?.scheduleLabel || "");
        const dateMatch = label.match(/(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) {
            return null;
        }

        const timeMatches = [...label.matchAll(/(\d{1,2}):(\d{2})/g)];
        const date = dateMatch[1];
        start = date;
        end = "";
        allDay = true;

        if (timeMatches.length > 0) {
            const [startHour, startMinute] = timeMatches[0].slice(1, 3);
            start = `${date}T${startHour.padStart(2, "0")}:${startMinute}:00`;
            allDay = false;
        }

        if (timeMatches.length > 1) {
            const [endHour, endMinute] = timeMatches[1].slice(1, 3);
            end = `${date}T${endHour.padStart(2, "0")}:${endMinute}:00`;
        }
    }

    return {
        id: event.id,
        title: event.title || "(タイトル未設定)",
        start,
        end,
        allDay,
        backgroundColor: event.type === "special" ? "#ec7b3a" : "#247246",
        borderColor: event.type === "special" ? "#ec7b3a" : "#247246",
        extendedProps: {
            sourceEventId: event.id,
            sourceType: event.type,
            scheduleLabel: event.scheduleLabel || "",
            minParticipants: event.minParticipants || "",
            maxParticipants: event.maxParticipants || ""
        }
    };
}

function toDatetimeLocalValue(value) {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduleLabelFromRange(startIso, endIso) {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) {
        return "";
    }
    const pad = (n) => String(n).padStart(2, "0");
    const dateLabel = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;

    if (!endIso) {
        return `${dateLabel} ${startTime}`;
    }

    const end = new Date(endIso);
    if (Number.isNaN(end.getTime())) {
        return `${dateLabel} ${startTime}`;
    }

    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return `${dateLabel} ${startTime}-${endTime}`;
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
        <p><strong>参加人数:</strong> ${event.minParticipants ? `${event.minParticipants}〜${event.maxParticipants || ""}名` : "制限なし"}</p>
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

    if (eventsLink) {
        eventsLink.href = config?.calendar?.management?.eventsEditUrl || "#";
        eventsLink.classList.toggle("disabled-link", eventsLink.href === "#");
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

        const result = await postToGas({
            action: "joinEvent",
            eventId: payload.eventId,
            name: payload.name,
            contact: payload.phone
        });
        if (result.ok) {
            setStatusText(status, `参加希望を送信しました。URL: ${result.url} | HTTP: ${result.status}`);
        } else {
            setCommFailureStatus(status, result);
            return;
        }
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

function openCommunityCreateModal(prefill = {}) {
    const modal = document.getElementById("community-event-create-modal");
    const form = document.getElementById("community-event-create-form");
    const status = document.getElementById("community-event-create-status");
    if (!(modal && form && status)) {
        return;
    }

    if (prefill.start) {
        const startInput = form.querySelector('input[name="start"]');
        if (startInput instanceof HTMLInputElement) {
            startInput.value = toDatetimeLocalValue(prefill.start);
        }
    }
    if (prefill.end) {
        const endInput = form.querySelector('input[name="end"]');
        if (endInput instanceof HTMLInputElement) {
            endInput.value = toDatetimeLocalValue(prefill.end);
        }
    }

    status.textContent = "";
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const titleInput = form.querySelector('input[name="title"]');
    if (titleInput instanceof HTMLElement) {
        titleInput.focus();
    }
}

function closeCommunityCreateModal() {
    const modal = document.getElementById("community-event-create-modal");
    if (!modal) {
        return;
    }
    modal.classList.add("hidden");
    document.body.style.overflow = "";
}

function bindCommunityCreateModal(config, events, onEventAdded) {
    const openButton = document.getElementById("open-community-event-create");
    const modal = document.getElementById("community-event-create-modal");
    const form = document.getElementById("community-event-create-form");
    const status = document.getElementById("community-event-create-status");
    const cancelButton = document.getElementById("community-event-create-cancel");
    const closeButton = document.getElementById("community-event-create-close");

    if (!(openButton && modal && form && status && cancelButton && closeButton)) {
        return;
    }

    openButton.addEventListener("click", () => {
        openCommunityCreateModal();
    });

    cancelButton.addEventListener("click", () => {
        form.reset();
        status.textContent = "入力内容をクリアしました。";
    });

    closeButton.addEventListener("click", () => {
        closeCommunityCreateModal();
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeCommunityCreateModal();
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const minParticipants = Number(fd.get("minParticipants") || 1);
        const maxParticipants = Number(fd.get("maxParticipants") || 0);

        if (!Number.isFinite(minParticipants) || !Number.isFinite(maxParticipants) || minParticipants < 1 || maxParticipants < minParticipants) {
            status.textContent = "参加人数の最小・最大を正しく入力してください。";
            return;
        }

        const start = String(fd.get("start") || "");
        const end = String(fd.get("end") || "");
        const newEvent = {
            id: `EV-${Date.now()}`,
            type: "special",
            title: String(fd.get("title") || "").trim(),
            category: "コミニティ",
            scheduleLabel: formatScheduleLabelFromRange(start, end),
            place: String(fd.get("place") || "").trim(),
            description: String(fd.get("description") || "").trim(),
            minParticipants,
            maxParticipants,
            start: start ? new Date(start).toISOString() : "",
            end: end ? new Date(end).toISOString() : "",
            recruitFormUrl: ""
        };

        if (!newEvent.title || !newEvent.start || !newEvent.place) {
            status.textContent = "イベント名・開始日時・場所は必須です。";
            return;
        }

        const posted = await postToGas({
            action: "addEvent",
            title: newEvent.title,
            start: newEvent.start,
            end: newEvent.end || newEvent.start,
            place: newEvent.place,
            description: newEvent.description,
            minParticipants: Number(newEvent.minParticipants || 0),
            maxParticipants: Number(newEvent.maxParticipants || 0)
        });

        if (!posted.ok) {
            setCommFailureStatus(status, posted);
            return;
        }

        events.push(newEvent);
        onEventAdded(newEvent);

        setStatusText(status, `コミニティ予定を登録しました。URL: ${posted.url} | HTTP: ${posted.status}`);
        form.reset();
        closeCommunityCreateModal();
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.classList.contains("hidden")) {
            closeCommunityCreateModal();
        }
    });
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

function openRecruitFormForEvent(events, eventId) {
    const select = document.getElementById("recruit-event-id");
    const form = document.getElementById("event-recruit-form");
    const status = document.getElementById("event-recruit-status");

    if (!(select && form && status)) {
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
}

async function submitLearningAttendance(config, event, result, statusEl) {
    if (!event?.id) {
        if (statusEl) {
            statusEl.textContent = "対象イベントが選択されていません。";
        }
        return;
    }

    const payload = {
        type: "eventAttendance",
        eventId: event.id,
        result,
        source: "eventPageTap",
        createdAt: new Date().toISOString()
    };

    const resultResponse = await postToGas({
        action: "joinEvent",
        eventId: payload.eventId,
        name: payload.result === "attend" ? "参加" : "不参加",
        contact: payload.source
    });
    if (statusEl) {
        if (resultResponse.ok) {
            setStatusText(statusEl, `「${result === "attend" ? "参加" : "不参加"}」を記録しました。URL: ${resultResponse.url} | HTTP: ${resultResponse.status}`);
        } else {
            setCommFailureStatus(statusEl, resultResponse);
        }
    }
}

function renderLearningSelectedEvent(event, events, config) {
    const title = document.getElementById("learning-selected-event-title");
    const datetime = document.getElementById("learning-selected-event-datetime");
    const place = document.getElementById("learning-selected-event-place");
    const capacity = document.getElementById("learning-selected-event-capacity");
    const description = document.getElementById("learning-selected-event-description");
    const attendButton = document.getElementById("learning-selected-event-attend");
    const declineButton = document.getElementById("learning-selected-event-decline");
    const responseStatus = document.getElementById("learning-selected-event-response-status");

    if (!(title && datetime && place && capacity && description && attendButton && declineButton && responseStatus)) {
        return;
    }

    if (!event) {
        title.textContent = "開催日を選択してください";
        datetime.textContent = "日時未選択";
        place.textContent = "-";
        capacity.textContent = "-";
        description.textContent = "説明がここに表示されます。";
        responseStatus.textContent = "";
        attendButton.disabled = true;
        declineButton.disabled = true;
        attendButton.onclick = null;
        declineButton.onclick = null;
        return;
    }

    title.textContent = event.title || "(タイトル未設定)";
    datetime.textContent = event.scheduleLabel || "日時未設定";
    place.textContent = event.place || "未設定";
    capacity.textContent = event.minParticipants
        ? `${event.minParticipants}〜${event.maxParticipants || ""}名`
        : "制限なし";
    description.textContent = event.description || "説明なし";
    responseStatus.textContent = "参加・不参加を選んで記録してください。";
    attendButton.disabled = false;
    declineButton.disabled = false;
    attendButton.onclick = async () => {
        await submitLearningAttendance(config, event, "attend", responseStatus);
    };
    declineButton.onclick = async () => {
        await submitLearningAttendance(config, event, "decline", responseStatus);
    };
}

function renderLearningCalendar(events, config) {
    const root = document.getElementById("learning-calendar");
    const status = document.getElementById("learning-calendar-status");
    if (!(root && status)) {
        return;
    }

    if (!window.FullCalendar) {
        status.textContent = "カレンダー表示ライブラリの読み込みに失敗しました。";
        return;
    }

    const calendarEvents = events
        .map(parseScheduleLabelToCalendarEvent)
        .filter(Boolean);

    const findEventByDate = (dateStr) => {
        if (!dateStr) {
            return null;
        }
        return events.find((event) => {
            const explicitStart = String(event?.start || "");
            if (explicitStart) {
                return explicitStart.slice(0, 10) === dateStr;
            }
            const matched = String(event?.scheduleLabel || "").match(/(\d{4}-\d{2}-\d{2})/);
            return Boolean(matched && matched[1] === dateStr);
        }) || null;
    };

    const calendar = new window.FullCalendar.Calendar(root, {
        locale: "ja",
        initialView: "dayGridMonth",
        height: "auto",
        selectable: true,
        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,listMonth"
        },
        buttonText: {
            today: "今日",
            month: "月",
            list: "一覧"
        },
        eventClick: (info) => {
            const sourceEventId = info.event.extendedProps?.sourceEventId || info.event.id;
            const selected = events.find((item) => item.id === sourceEventId);
            renderLearningSelectedEvent(selected, events, config);
            if (selected?.id) {
                openRecruitFormForEvent(events, selected.id);
            }
        },
        dateClick: (info) => {
            const selected = findEventByDate(String(info.dateStr || ""));
            if (selected?.id) {
                renderLearningSelectedEvent(selected, events, config);
                openRecruitFormForEvent(events, selected.id);
                return;
            }
            openCommunityCreateModal({ start: info.date, end: "" });
        },
        select: (info) => {
            openCommunityCreateModal({ start: info.start, end: info.end });
        }
    });

    calendar.render();
    calendarEvents.forEach((event) => {
        calendar.addEvent(event);
    });

    if (calendarEvents.length === 0) {
        status.textContent = "日付付き開催がまだないため、カレンダーに表示できる予定はありません。";
    } else {
        status.textContent = `カレンダーに${calendarEvents.length}件の開催予定を表示しています。予定をタップすると下に開催内容が表示されます。`;
    }

    return calendar;
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

        const result = await postToGas({
            action: "joinEvent",
            eventId: payload.eventId,
            name: payload.memberName,
            contact: payload.memo || payload.result
        });
        if (!result.ok) {
            setCommFailureStatus(status, result);
            return;
        }
        setStatusText(status, `参加結果を記録しました。URL: ${result.url} | HTTP: ${result.status}`);
        form.reset();
        if (select.options.length > 0) {
            select.selectedIndex = 0;
        }
    });
}

async function handleEventFormSubmit(e, form, statusEl, type, config) {
    e.preventDefault();

    try {
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

        if (!event.title || !event.category || !event.scheduleLabel || !event.place) {
            setStatusText(statusEl, "通信試行終了（入力不足）");
            return;
        }

        const payload = {
            action: "addEvent",
            title: event.title,
            start: event.start || event.scheduleLabel,
            end: event.end || event.start || event.scheduleLabel,
            place: event.place,
            description: event.description
        };
        const result = await postToGas(payload);
        if (!result.ok) {
            setCommFailureStatus(statusEl, result);
            return;
        }
        setStatusText(statusEl, buildDebugStatus(payload.action, payload, result));
    } catch {
        setCommFailureStatus(statusEl, {
            url: getGasUrl(),
            status: 0,
            error: "例外が発生しました。"
        });
    }
}

function normalizeRecurringTime(value) {
    const text = String(value || "").trim();
    if (!text) {
        return "00:00:00";
    }

    const parts = text.split(":").map((part) => Number(part));
    const hours = Number.isFinite(parts[0]) ? Math.max(0, Math.min(23, parts[0])) : 0;
    const minutes = Number.isFinite(parts[1]) ? Math.max(0, Math.min(59, parts[1])) : 0;
    const seconds = Number.isFinite(parts[2]) ? Math.max(0, Math.min(59, parts[2])) : 0;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function bindRecurringEventForm() {
    const form = document.getElementById("admin-recurring-event-form");
    const status = document.getElementById("admin-recurring-event-status");
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const fd = new FormData(form);
            const title = String(fd.get("title") || "").trim();
            const category = String(fd.get("category") || "").trim();
            const place = String(fd.get("place") || "").trim();
            const description = String(fd.get("description") || "").trim();
            const weekOfMonth = String(fd.get("weekOfMonth") || "1");
            const dayOfWeek = String(fd.get("dayOfWeek") || "0");
            const startTime = normalizeRecurringTime(fd.get("startTime"));
            const endTime = normalizeRecurringTime(fd.get("endTime"));

            if (!title || !category || !place || !startTime || !endTime) {
                setStatusText(status, "通信試行終了（入力不足）");
                return;
            }

            const payload = {
                action: "addRecurringEvent",
                title,
                category,
                place,
                description,
                weekOfMonth,
                dayOfWeek,
                startTime,
                endTime
            };

            const result = await postToGas(payload);
            if (!result.ok) {
                setCommFailureStatus(status, result);
                return;
            }
            setStatusText(status, buildDebugStatus(payload.action, payload, result));
        } catch {
            setCommFailureStatus(status, {
                url: getGasUrl(),
                status: 0,
                error: "例外が発生しました。"
            });
        }
    });
}

function bindSimpleAdminForm(formId, statusId, action, kind) {
    const form = document.getElementById(formId);
    const status = document.getElementById(statusId);
    if (!form || !status) {
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const fd = new FormData(form);
            const fields = Object.fromEntries(fd.entries());
            let requestPayload = { action, createdAt: new Date().toISOString() };

            if (action === "addPeople") {
                requestPayload = {
                    ...requestPayload,
                    userId: String(fields.userId || fields.phone || "").trim(),
                    pin: String(fields.pin || "").trim(),
                    name: String(fields.name || "").trim(),
                    role: String(fields.role || "一般").trim()
                };
            } else if (action === "addEquipmentMaster") {
                requestPayload = {
                    ...requestPayload,
                    equipmentName: String(fields.equipmentName || "").trim(),
                    stock: Number(fields.stock || 0),
                    location: String(fields.location || "").trim(),
                    memo: String(fields.memo || "").trim(),
                    state: "良好"
                };
            } else {
                requestPayload = {
                    ...requestPayload,
                    type: kind,
                    data: fields
                };
            }

            const result = await postToGas(requestPayload);
            if (!result.ok) {
                setCommFailureStatus(status, result);
                return;
            }
            setStatusText(status, buildDebugStatus(action, requestPayload, result));
        } catch {
            setCommFailureStatus(status, {
                url: getGasUrl(),
                status: 0,
                error: "例外が発生しました。"
            });
        }
    });
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました。"));
        reader.readAsDataURL(file);
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
        try {
            const fd = new FormData(form);
            const files = fd.getAll("files").filter((file) => file instanceof File && file.size > 0);
            if (files.length === 0) {
                setStatusText(status, "通信試行終了（入力不足）");
                return;
            }

            const destination = String(fd.get("destination") || "").trim();
            const category = String(fd.get("category") || "").trim();
            const title = String(fd.get("title") || "").trim();
            const uploader = String(fd.get("uploaderName") || "admin").trim();

            let lastResult = null;
            for (const file of files) {
                const fileData = await fileToDataUrl(file);
                lastResult = await postToGas({
                    action: "uploadDocument",
                    destination,
                    category,
                    title: title || file.name,
                    uploader,
                    fileName: file.name,
                    mimeType: file.type || "application/pdf",
                    fileData
                });

                if (!lastResult.ok) {
                    setCommFailureStatus(status, lastResult);
                    return;
                }
            }

            const debugPayload = {
                action: "uploadDocument",
                destination,
                category,
                title,
                fileCount: files.length
            };
            setStatusText(status, buildDebugStatus("uploadDocument", debugPayload, lastResult || { ok: true, url: getGasUrl(), status: 200 }));
        } catch {
            setCommFailureStatus(status, {
                url: getGasUrl(),
                status: 0,
                error: "例外が発生しました。"
            });
        }
    });
}

function setAdminPanelsVisible(isVisible) {
    const protectedArea = document.getElementById("admin-protected");
    if (!protectedArea) {
        return;
    }
    protectedArea.classList.toggle("hidden", !isVisible);

    const controls = protectedArea.querySelectorAll("input, select, textarea, button");
    controls.forEach((control) => {
        if (control instanceof HTMLInputElement
            || control instanceof HTMLSelectElement
            || control instanceof HTMLTextAreaElement
            || control instanceof HTMLButtonElement) {
            control.disabled = !isVisible;
        }
    });
}

function bindAdminLogin() {
    const form = document.getElementById("admin-login-form");
    const status = document.getElementById("admin-login-status");
    const currentRole = document.getElementById("admin-current-role");

    if (!form || !status) {
        return;
    }

    setAdminPanelsVisible(false);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        const payload = {
            action: "login",
            userId: String(fd.get("userId") || "").trim(),
            pin: String(fd.get("pin") || "").trim()
        };

        const result = await postToGas(payload);
        if (!result.ok) {
            setAdminPanelsVisible(false);
            setCommFailureStatus(status, result);
            return;
        }

        const loginResult = result?.response?.data || result?.response || {};
        const isOfficer = String(loginResult?.role || "") === "役員";
        if (!isOfficer || loginResult?.success === false) {
            setAdminPanelsVisible(false);
            const message = String(loginResult?.error || loginResult?.message || "役員アカウントのみ利用できます。");
            setStatusText(status, `【通信失敗】URL: ${result.url} | エラー内容: HTTP=${result.status || "N/A"} / ${message}`, true);
            return;
        }

        setAdminPanelsVisible(true);
        setStatusText(status, `ログイン成功: URL=${result.url} | HTTP=${result.status}`);
        if (currentRole) {
            currentRole.textContent = `ログイン中: ${String(loginResult?.name || "") || payload.userId}（${String(loginResult?.role || "") || "役員"}）`;
        }
    });
}

function bindAdminCalendarCreateFormStandalone(config) {
    const createForm = document.getElementById("admin-calendar-create-form");
    const createStatus = document.getElementById("admin-calendar-create-status");

    if (!(createForm && createStatus)) {
        return;
    }

    if (createForm.dataset.listenerBound === "true") {
        return;
    }
    createForm.dataset.listenerBound = "true";

    createForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        createStatus.style.color = "inherit";
        createStatus.textContent = "通信中...";

        const fd = new FormData(createForm);
        const payload = {
            action: "addTownEvent",
            title: String(fd.get("title") || "").trim(),
            start: String(fd.get("start") || ""),
            end: String(fd.get("end") || ""),
            place: String(fd.get("location") || "").trim(),
            description: String(fd.get("description") || "").trim(),
            allDay: createForm.querySelector('input[name="allDay"]')?.checked || false
        };

        try {
            const result = await postToGas(payload);
            if (!result?.ok) {
                setCommFailureStatus(createStatus, result);
                return;
            }

            createStatus.style.color = "green";
            createStatus.textContent = `送信成功: URL=${result.url} | HTTP=${result.status}`;
            createForm.reset();
        } catch (err) {
            createStatus.style.color = "red";
            createStatus.textContent = `【通信失敗】URL: ${getGasUrl()} | エラー: ${err instanceof Error ? err.message : String(err)}`;
        }
    });
}

function bindLearningEventSelection(events) {
    const list = document.getElementById("managed-events-list");
    if (!list) {
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

        openRecruitFormForEvent(events, eventId);
    });
}

export async function initManagedEventsPage(config) {
    const calendarRoot = document.getElementById("learning-calendar");
    if (!calendarRoot) {
        return;
    }

    let loadedEvents = [];
    try {
        loadedEvents = await loadManagedEvents(config);
    } catch {
        loadedEvents = [];
    }

    const displayEvents = Array.isArray(loadedEvents)
        ? loadedEvents.filter((event) => isLearningEvent(event) && event.type === "special")
        : [];

    let learningCalendar = null;
    try {
        renderLearningSelectedEvent(null, displayEvents, config);
        learningCalendar = renderLearningCalendar(displayEvents, config) || null;
    } catch {
        renderLearningSelectedEvent(null, [], config);
        learningCalendar = renderLearningCalendar([], config) || null;
    }

    try {
        bindRecruitForm(config, displayEvents);
        bindRecruitModalActions();
        bindLearningEventSelection(displayEvents);
    } catch {
        // テストモードでは参加フォーム初期化失敗を無視する。
    }

    try {
        bindCommunityCreateModal(config, displayEvents, (newEvent) => {
            if (learningCalendar) {
                const parsed = parseScheduleLabelToCalendarEvent(newEvent);
                if (parsed) {
                    learningCalendar.addEvent(parsed);
                }
            }
            renderLearningSelectedEvent(newEvent, displayEvents, config);
        });
    } catch {
        // テストモードでは初期化失敗を握りつぶして継続する。
    }
}

export function initAdminCommunityForms(config) {
    try {
        bindAdminLogin();
    } catch {
        // テストモードではログインUI初期化失敗を無視する。
    }

    try {
        bindAdminCalendarCreateFormStandalone(config);
    } catch {
        // テストモードでは最優先の送信フォーム登録失敗も握りつぶして継続する。
    }

    try {
        applyEventsSheetLink(config);
    } catch {
        // テストモードではリンク反映失敗を無視する。
    }
    try {
        applyAdminDataLinks(config);
    } catch {
        // テストモードではリンク反映失敗を無視する。
    }
    try {
        bindRecurringEventForm();
    } catch {
        // テストモードではフォーム初期化失敗を無視する。
    }

    try {
        bindDriveDocUploadForm(config);
    } catch {
        // テストモードではフォーム初期化失敗を無視する。
    }
    try {
        bindSimpleAdminForm(
            "admin-people-form",
            "admin-people-status",
            "addPeople",
            "peopleLedger"
        );
    } catch {
        // テストモードではフォーム初期化失敗を無視する。
    }

    try {
        bindSimpleAdminForm(
            "admin-equipment-ledger-form",
            "admin-equipment-ledger-status",
            "addEquipmentMaster",
            "equipmentLedger"
        );
    } catch {
        // テストモードではフォーム初期化失敗を無視する。
    }
}
