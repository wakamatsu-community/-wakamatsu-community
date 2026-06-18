import { gasGet, gasPost, getGasUrl } from "./gas-api.js";
import { loadAllManagedEvents } from "./community-admin.js";

const LOCAL_ADDED_EVENTS_KEY = "wakamatsu_calendar_added_events_v1";

function toIsoDate(value) {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return date.toISOString();
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

function loadLocalAddedEvents() {
    try {
        const raw = localStorage.getItem(LOCAL_ADDED_EVENTS_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveLocalAddedEvents(events) {
    localStorage.setItem(LOCAL_ADDED_EVENTS_KEY, JSON.stringify(events));
}

function normalizeGasCalendarEvents(payload) {
    const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
            ? payload.events
            : Array.isArray(payload?.data)
                ? payload.data
                : [];

    return rows.map((item, index) => {
        const startValue = item?.start || item?.startDateTime || item?.startDate || "";
        const endValue = item?.end || item?.endDateTime || item?.endDate || "";
        const allDay = Boolean(item?.allDay || (String(startValue).length === 10 && !String(startValue).includes("T")));
        return {
            id: String(item?.id || `gas-${index}-${Date.now()}`),
            title: item?.title || item?.summary || "(タイトル未設定)",
            start: startValue,
            end: endValue,
            allDay,
            backgroundColor: "#247246",
            borderColor: "#247246",
            extendedProps: {
                location: item?.location || "",
                description: item?.description || "",
                source: "gas"
            }
        };
    }).filter((event) => event.start);
}

async function fetchCalendarEventsFromGas() {
    try {
        const payload = await gasGet({ type: "calendar_events" });
        return normalizeGasCalendarEvents(payload);
    } catch {
        return [];
    }
}

function parseManagedScheduleToEvent(event, index = 0) {
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

    if (!start) {
        return null;
    }

    return {
        id: String(event?.id || `managed-${index}-${Date.now()}`),
        title: String(event?.title || "(タイトル未設定)"),
        start,
        end,
        allDay,
        backgroundColor: "#ec7b3a",
        borderColor: "#ec7b3a",
        extendedProps: {
            location: String(event?.place || ""),
            description: String(event?.description || ""),
            source: "managed"
        }
    };
}

async function fetchManagedEventsForCalendar(config) {
    try {
        const managed = await loadAllManagedEvents(config);
        if (!Array.isArray(managed)) {
            return [];
        }

        return managed
            .map((event, index) => parseManagedScheduleToEvent(event, index))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function toLocalCalendarEvent(event) {
    return {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end || "",
        allDay: Boolean(event.allDay),
        backgroundColor: "#ec7b3a",
        borderColor: "#ec7b3a",
        extendedProps: {
            location: event.location || "",
            description: event.description || "",
            source: "local"
        }
    };
}

function renderEventDetailModal(info) {
    const title = document.getElementById("calendar-selected-event-title");
    const datetime = document.getElementById("calendar-selected-event-datetime");
    const location = document.getElementById("calendar-selected-event-location");
    const description = document.getElementById("calendar-selected-event-description");

    if (!(title && datetime && location && description)) {
        return;
    }

    const event = info.event;
    title.textContent = event.title || "(タイトル未設定)";
    datetime.textContent = event.start
        ? event.start.toLocaleString("ja-JP")
        : "日時未設定";
    location.textContent = event.extendedProps?.location || "場所未設定";
    description.textContent = event.extendedProps?.description || "説明なし";
}

async function saveTownCalendarEvent(formData) {
    const title = String(formData.get("title") || "").trim();
    const start = String(formData.get("start") || "");
    const end = String(formData.get("end") || "");
    const location = String(formData.get("location") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const allDay = formData.get("allDay") === "on";

    if (!title || !start) {
        return { ok: false, message: "イベント名と開始日時は必須です。" };
    }

    const event = {
        id: `local-${Date.now()}`,
        title,
        start: allDay ? start.slice(0, 10) : toIsoDate(start),
        end: end ? (allDay ? end.slice(0, 10) : toIsoDate(end)) : "",
        allDay,
        location,
        description
    };

    const requestUrl = getGasUrl();

    try {
        const response = await gasPost({
            action: "addTownEvent",
            title,
            start: event.start,
            end: event.end || event.start,
            place: location,
            description,
            creator: "",
            minParticipants: 0,
            maxParticipants: 0,
            allDay,
            createdAt: new Date().toISOString()
        });

        const hasBusinessError = response && (
            response.ok === false
            || response.success === false
            || response.result === false
            || response.isError === true
            || Boolean(response.error)
        );

        if (hasBusinessError) {
            const errorText = String(response?.error || response?.message || "GASから失敗応答が返されました。");
            const failUrl = String(response?._requestUrl || requestUrl);
            const failStatus = Number(response?._httpStatus || 0);
            return {
                ok: false,
                message: `【通信失敗】URL: ${failUrl} | エラー内容: HTTP=${failStatus || "N/A"} / ${errorText}`,
                url: failUrl,
                httpStatus: failStatus
            };
        }

        const successUrl = String(response?._requestUrl || requestUrl);
        const successStatus = Number(response?._httpStatus || 200);
        return {
            ok: true,
            message: `送信成功 URL: ${successUrl} | HTTP: ${successStatus}`,
            url: successUrl,
            httpStatus: successStatus
        };
    } catch (error) {
        const errorText = String(error && error.message || error || "不明なエラー");
        return {
            ok: false,
            message: `【通信失敗】URL: ${requestUrl} | エラー内容: ${errorText}`,
            url: requestUrl,
            httpStatus: 0
        };
    }
}

function setCalendarConnectionStatus(message) {
    const status = document.getElementById("calendar-connection-status");
    if (status) {
        status.textContent = message;
    }
}

export async function initCalendarPage(config = {}) {
    const calendarRoot = document.getElementById("custom-calendar");
    if (!calendarRoot) {
        return;
    }

    if (!window.FullCalendar) {
        setCalendarConnectionStatus("FullCalendarの読み込みに失敗しました。");
        return;
    }

    const calendar = new window.FullCalendar.Calendar(calendarRoot, {
        locale: "ja",
        initialView: "dayGridMonth",
        height: "auto",
        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listMonth"
        },
        buttonText: {
            today: "今日",
            month: "月",
            week: "週",
            list: "一覧"
        },
        eventClick: renderEventDetailModal
    });

    calendar.render();

    const loadingFallbackTimer = setTimeout(() => {
        setCalendarConnectionStatus("現在予定はありません");
    }, 3000);

    let gasEvents = [];
    let managedEvents = [];
    let localEvents = [];

    try {
        const [fetchedGasEvents, fetchedManagedEvents] = await Promise.all([
            fetchCalendarEventsFromGas(),
            fetchManagedEventsForCalendar(config)
        ]);
        gasEvents = Array.isArray(fetchedGasEvents) ? fetchedGasEvents : [];
        managedEvents = Array.isArray(fetchedManagedEvents) ? fetchedManagedEvents : [];
        localEvents = loadLocalAddedEvents().map(toLocalCalendarEvent);
    } catch {
        gasEvents = [];
        managedEvents = [];
        localEvents = [];
    }

    clearTimeout(loadingFallbackTimer);

    gasEvents.forEach((event) => calendar.addEvent(event));
    managedEvents.forEach((event) => calendar.addEvent(event));
    localEvents.forEach((event) => calendar.addEvent(event));

    const totalEvents = gasEvents.length + managedEvents.length + localEvents.length;
    if (totalEvents > 0) {
        setCalendarConnectionStatus(`予定を${totalEvents}件表示中です。`);
    } else {
        setCalendarConnectionStatus("現在予定はありません");
    }
}

export function initAdminCalendarForm() {
    const form = document.getElementById("admin-calendar-create-form");
    const status = document.getElementById("admin-calendar-create-status");
    if (!(form && status)) {
        return;
    }

    status.textContent = "登録内容はGASへ送信されます。";
    status.style.color = "";
    status.style.fontWeight = "";

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await saveTownCalendarEvent(new FormData(form));
        status.textContent = result.message;
        status.style.color = result.ok ? "" : "#c62828";
        status.style.fontWeight = result.ok ? "" : "700";
        if (result.ok) {
            form.reset();
            const startInput = form.querySelector('input[name="start"]');
            if (startInput instanceof HTMLInputElement) {
                startInput.value = toDatetimeLocalValue(new Date());
            }
        }
    });
}
