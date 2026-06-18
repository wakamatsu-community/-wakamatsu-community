import { gasGet, gasPost, getGasUrl } from "./gas-api.js";

const STATUS_CACHE_KEY = "wakamatsu_equipment_status_v1";

function normalize(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function isConfigured(url) {
    return Boolean(url && !url.includes("sample-"));
}

function formatDate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function getWeekStart(baseDate) {
    const d = new Date(baseDate);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    start.setDate(start.getDate() - start.getDay());
    return start;
}

function inRange(target, start, end) {
    const t = normalize(target);
    return t >= normalize(start) && t <= normalize(end);
}

function itemListToLabel(items) {
    return items.map((item) => `${item.equipmentLabel} x${item.quantity}`).join(" / ");
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
        const text = await res.text();
        const data = parseGvizJson(text);
        return data?.table?.rows || [];
    } catch {
        return null;
    }
}

function buildSearchIndex(items) {
    return items.map((item) => ({
        ...item,
        _search: normalize(`${item.label} ${(item.aliases || []).join(" ")}`)
    }));
}

function toFlatReservationItems(sourceList) {
    return sourceList.flatMap((entry) => {
        if (entry.items && Array.isArray(entry.items)) {
            return entry.items.map((item) => ({
                recordId: entry.id,
                createdAt: entry.createdAt,
                equipmentId: item.equipmentId,
                equipmentLabel: item.equipmentLabel,
                quantity: Number(item.quantity || 1),
                loanDate: item.loanDate,
                returnDate: item.returnDate
            }));
        }

        return [{
            recordId: entry.id || `R-${Date.now()}`,
            createdAt: entry.createdAt || new Date().toISOString(),
            equipmentId: entry.equipmentId,
            equipmentLabel: entry.equipmentLabel,
            quantity: Number(entry.quantity || 1),
            loanDate: entry.loanDate,
            returnDate: entry.returnDate
        }];
    });
}

async function loadEquipmentItems(config) {
    const rows = await fetchSheetRows(config?.equipment?.sheets?.masterSheetUrl);
    if (!rows) {
        return config?.equipment?.items || [];
    }

    const parsed = rows
        .map((row) => {
            const c = row.c || [];
            return {
                id: String(c[0]?.v || "").trim(),
                label: String(c[1]?.v || "").trim(),
                stock: Number(c[2]?.v || 1),
                aliases: String(c[3]?.v || "").split(",").map((x) => x.trim()).filter(Boolean)
            };
        })
        .filter((item) => item.id && item.label);

    return parsed.length > 0 ? parsed : (config?.equipment?.items || []);
}

async function loadReservationItems(config) {
    try {
        const payload = await gasGet({ type: "equipment_status" });
        const rows = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.data)
                    ? payload.data
                    : [];

        const parsed = rows
            .map((row, index) => ({
                recordId: String(row?.recordId || row?.id || `R-${Date.now()}-${index}`),
                equipmentId: String(row?.equipmentId || ""),
                equipmentLabel: String(row?.equipmentLabel || row?.equipment || ""),
                quantity: Number(row?.quantity || 1),
                loanDate: String(row?.loanDate || row?.loan || ""),
                returnDate: String(row?.returnDate || row?.return || ""),
                createdAt: String(row?.createdAt || new Date().toISOString())
            }))
            .filter((item) => item.equipmentLabel && item.loanDate && item.returnDate);

        if (parsed.length > 0) {
            localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(parsed));
            return parsed;
        }
    } catch {
        // 通信失敗時は安全データのみのローカルキャッシュへフォールバック
    }

    const saved = localStorage.getItem(STATUS_CACHE_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch {
            localStorage.removeItem(STATUS_CACHE_KEY);
        }
    }

    const mockFlat = toFlatReservationItems(config?.equipment?.mockReservations || []);
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(mockFlat));
    return mockFlat;
}

function saveReservationItemsLocal(items) {
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(items));
}

async function submitToGas(payload) {
    const requestUrl = getGasUrl();
    try {
        const response = await gasPost(payload);
        const hasBusinessError = response && (
            response.ok === false
            || response.success === false
            || response.result === false
            || response.isError === true
            || Boolean(response.error)
        );

        if (hasBusinessError) {
            return {
                ok: false,
                url: String(response?._requestUrl || requestUrl),
                status: Number(response?._httpStatus || 200),
                error: String(response?.error || response?.message || "GASから失敗応答が返されました。")
            };
        }

        return {
            ok: true,
            url: String(response?._requestUrl || requestUrl),
            status: Number(response?._httpStatus || 200),
            error: ""
        };
    } catch (error) {
        return {
            ok: false,
            url: requestUrl,
            status: 0,
            error: String(error && error.message || error)
        };
    }
}

function getUsedQuantity(flatItems, equipmentId, date) {
    return flatItems
        .filter((item) => item.equipmentId === equipmentId && inRange(date, item.loanDate, item.returnDate))
        .reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

function getMinRemainingOnRange(flatItems, equipmentId, stock, startDate, endDate) {
    let current = startDate;
    let minRemaining = stock;
    while (current <= endDate) {
        const dateStr = formatDate(current);
        const used = getUsedQuantity(flatItems, equipmentId, dateStr);
        minRemaining = Math.min(minRemaining, stock - used);
        current = addDays(current, 1);
    }
    return minRemaining;
}

function createGanttCell(dateStr, used, stock) {
    const cell = document.createElement("button");
    cell.type = "button";
    const remaining = stock - used;
    const statusClass = remaining <= 0 ? "loaned" : remaining < stock ? "partial" : "free";
    cell.className = `gantt-cell ${statusClass}`;
    cell.dataset.date = dateStr;
    cell.dataset.remaining = String(Math.max(0, remaining));
    cell.textContent = remaining <= 0 ? "満" : `空${remaining}`;
    return cell;
}

function applySheetLinks(config, ids) {
    const master = document.getElementById(ids.master);
    const reserve = document.getElementById(ids.reservation);
    const masterUrl = config?.equipment?.sheets?.masterEditUrl || "#";
    const reserveUrl = config?.equipment?.sheets?.reservationEditUrl || "#";

    if (master) {
        master.href = masterUrl;
        master.classList.toggle("disabled-link", masterUrl === "#");
    }
    if (reserve) {
        reserve.href = reserveUrl;
        reserve.classList.toggle("disabled-link", reserveUrl === "#");
    }
}

export async function initEquipmentPage(config) {
    const select = document.getElementById("equipment-select");
    const searchInput = document.getElementById("equipment-search");
    const selectedNote = document.getElementById("equipment-selected-note");
    const timelineStartInput = document.getElementById("timeline-start-date");
    const timelineReset = document.getElementById("timeline-reset");
    const ganttRoot = document.getElementById("equipment-gantt");
    const selectionNote = document.getElementById("gantt-selection-note");

    const form = document.getElementById("equipment-reservation-form");
    const formEquipment = document.getElementById("reserve-equipment");
    const formQuantity = document.getElementById("reserve-quantity");
    const formLoanDate = document.getElementById("reserve-loan-date");
    const formReturnDate = document.getElementById("reserve-return-date");
    const addItemButton = document.getElementById("add-reservation-item");
    const itemsList = document.getElementById("reservation-items");
    const itemsEmpty = document.getElementById("reservation-items-empty");
    const formStatus = document.getElementById("reservation-status");

    if (!select || !searchInput || !ganttRoot || !form || !timelineStartInput || !formQuantity || !addItemButton || !itemsList) {
        return;
    }

    const indexedItems = buildSearchIndex(await loadEquipmentItems(config));

    let filteredItems = indexedItems;
    let selectedItem = indexedItems[0] || null;
    let reservationItems = await loadReservationItems(config);
    let rangeStart = new Date();
    let tapStartDate = "";
    let pendingItems = [];

    function refreshPendingList() {
        itemsList.innerHTML = "";
        if (pendingItems.length === 0) {
            itemsEmpty?.classList.remove("hidden");
            return;
        }

        itemsEmpty?.classList.add("hidden");
        pendingItems.forEach((item, index) => {
            const li = document.createElement("li");
            li.textContent = `${item.equipmentLabel} x${item.quantity} / ${item.loanDate} 〜 ${item.returnDate}`;

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "button mini-button";
            removeButton.textContent = "削除";
            removeButton.addEventListener("click", () => {
                pendingItems = pendingItems.filter((_, i) => i !== index);
                refreshPendingList();
                renderGantt();
            });

            li.appendChild(removeButton);
            itemsList.appendChild(li);
        });
    }

    function fillSelect(items) {
        const previous = select.value;
        select.innerHTML = "";

        items.forEach((item) => {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `${item.label}（在庫${item.stock}）`;
            select.appendChild(option);
        });

        if (items.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "該当なし";
            select.appendChild(option);
            select.disabled = true;
            selectedItem = null;
            return;
        }

        select.disabled = false;
        const restored = items.find((item) => item.id === previous) || items[0];
        select.value = restored.id;
        selectedItem = restored;
    }

    function renderGantt() {
        ganttRoot.innerHTML = "";

        if (!selectedItem) {
            ganttRoot.innerHTML = "<p class='note'>備品が選択されていません。</p>";
            return;
        }

        const rangeStartWeek = getWeekStart(rangeStart);
        const dates = Array.from({ length: 28 }, (_, i) => formatDate(addDays(rangeStartWeek, i)));

        const header = document.createElement("div");
        header.className = "gantt-header";
        header.innerHTML = "<span>週/曜日</span>";
        ["日", "月", "火", "水", "木", "金", "土"].forEach((day) => {
            const label = document.createElement("span");
            label.textContent = day;
            header.appendChild(label);
        });

        const effectiveItems = [...reservationItems, ...pendingItems.map((item) => ({ ...item, recordId: "TEMP" }))];
        const stock = Number(selectedItem.stock || 1);

        const rows = [];
        for (let week = 0; week < 4; week += 1) {
            const row = document.createElement("div");
            row.className = "gantt-row";

            const weekStartDate = dates[week * 7];
            const weekEndDate = dates[week * 7 + 6];
            const nameCell = document.createElement("span");
            nameCell.className = "gantt-equipment-name";
            nameCell.textContent = `${Number(weekStartDate.slice(5, 7))}/${Number(weekStartDate.slice(8, 10))}〜${Number(weekEndDate.slice(5, 7))}/${Number(weekEndDate.slice(8, 10))}`;
            row.appendChild(nameCell);

            dates.slice(week * 7, week * 7 + 7).forEach((date) => {
                const used = getUsedQuantity(effectiveItems, selectedItem.id, date);
                const cell = createGanttCell(date, used, stock);
                cell.addEventListener("click", () => {
                    const remaining = Number(cell.dataset.remaining || "0");
                    if (remaining <= 0) {
                        selectionNote.textContent = "貸出中の日付は選択できません。";
                        return;
                    }

                    if (!tapStartDate || date < tapStartDate) {
                        tapStartDate = date;
                        formLoanDate.value = date;
                        formReturnDate.value = date;
                        formQuantity.max = String(remaining);
                        formQuantity.value = "1";
                        selectionNote.textContent = `開始日を ${date} に設定しました。`;
                    } else {
                        formLoanDate.value = tapStartDate;
                        formReturnDate.value = date;
                        const minRemaining = getMinRemainingOnRange(
                            effectiveItems,
                            selectedItem.id,
                            stock,
                            new Date(tapStartDate),
                            new Date(date)
                        );
                        formQuantity.max = String(Math.max(1, minRemaining));
                        formQuantity.value = String(Math.min(Number(formQuantity.value || 1), Math.max(1, minRemaining)));
                        selectionNote.textContent = `利用期間を ${tapStartDate} 〜 ${date} に設定しました。`;
                    }
                });
                row.appendChild(cell);
            });

            rows.push(row);
        }

        ganttRoot.append(header, ...rows);
        selectedNote.textContent = `表示中: ${selectedItem.label}`;
        formEquipment.value = selectedItem.label;
    }

    function applySearch() {
        const keyword = normalize(searchInput.value);
        filteredItems = indexedItems.filter((item) => item._search.includes(keyword));
        fillSelect(filteredItems);
        tapStartDate = "";
        renderGantt();
    }

    function hasConflict(equipmentId, loanDate, returnDate, quantity) {
        const stock = Number((indexedItems.find((item) => item.id === equipmentId)?.stock) || 1);
        let current = new Date(loanDate);
        const end = new Date(returnDate);
        const effectiveItems = [...reservationItems, ...pendingItems.map((item) => ({ ...item, recordId: "TEMP" }))];

        while (current <= end) {
            const used = getUsedQuantity(effectiveItems, equipmentId, formatDate(current));
            if (used + quantity > stock) {
                return true;
            }
            current = addDays(current, 1);
        }
        return false;
    }

    addItemButton.addEventListener("click", () => {
        if (!selectedItem) {
            formStatus.textContent = "備品を選択してください。";
            return;
        }

        const quantity = Number(formQuantity.value || 1);
        const loanDate = String(formLoanDate.value || "");
        const returnDate = String(formReturnDate.value || "");

        if (!loanDate || !returnDate) {
            formStatus.textContent = "貸出日と返納日を選択してください。";
            return;
        }
        if (returnDate < loanDate) {
            formStatus.textContent = "返納日は貸出日以降を指定してください。";
            return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
            formStatus.textContent = "数量は1以上の整数で入力してください。";
            return;
        }
        if (hasConflict(selectedItem.id, loanDate, returnDate, quantity)) {
            formStatus.textContent = "在庫を超えるため、この数量では予約できません。";
            return;
        }

        pendingItems.push({
            equipmentId: selectedItem.id,
            equipmentLabel: selectedItem.label,
            quantity,
            loanDate,
            returnDate
        });

        formStatus.textContent = `${selectedItem.label} x${quantity} を予約リストへ追加しました。`;
        tapStartDate = "";
        refreshPendingList();
        renderGantt();
    });

    fillSelect(filteredItems);
    const today = formatDate(new Date());
    timelineStartInput.value = today;
    rangeStart = new Date(today);
    renderGantt();
    refreshPendingList();

    searchInput.addEventListener("input", applySearch);
    select.addEventListener("change", () => {
        selectedItem = filteredItems.find((item) => item.id === select.value) || filteredItems[0] || null;
        tapStartDate = "";
        renderGantt();
    });
    timelineStartInput.addEventListener("change", () => {
        rangeStart = new Date(timelineStartInput.value || today);
        tapStartDate = "";
        renderGantt();
    });
    timelineReset.addEventListener("click", () => {
        const currentWeekStart = getWeekStart(new Date());
        rangeStart = currentWeekStart;
        timelineStartInput.value = formatDate(currentWeekStart);
        tapStartDate = "";
        renderGantt();
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (pendingItems.length === 0) {
            formStatus.textContent = "先に備品を予約リストへ追加してください。";
            return;
        }

        const formData = new FormData(form);
        const name = String(formData.get("name") || "").trim();
        const phone = String(formData.get("phone") || "").trim();
        const group = String(formData.get("group") || "").trim();

        if (!name || !phone || !group) {
            formStatus.textContent = "氏名・電話番号・組班を入力してください。";
            return;
        }

        const recordId = `R-${Date.now()}`;
        const createdAt = new Date().toISOString();

        const flatRows = pendingItems.map((item) => ({
            recordId,
            equipmentId: item.equipmentId,
            equipmentLabel: item.equipmentLabel,
            quantity: item.quantity,
            loanDate: item.loanDate,
            returnDate: item.returnDate,
            createdAt
        }));

        const posted = await submitToGas({
            action: "reserveEquipment",
            type: "equipmentReservation",
            recordId,
            applicant: name,
            phone,
            group,
            items: pendingItems.map((item) => ({
                equipment: item.equipmentLabel,
                equipmentId: item.equipmentId,
                quantity: item.quantity,
                loanDate: item.loanDate,
                returnDate: item.returnDate
            })),
            createdAt
        });

        reservationItems = [...reservationItems, ...flatRows];
        if (!posted.ok) {
            saveReservationItemsLocal(reservationItems);
            formStatus.textContent = `【通信失敗】URL: ${posted.url} | エラー内容: HTTP=${posted.status || "N/A"} / ${posted.error}`;
        } else {
            formStatus.textContent = `送信成功: URL=${posted.url} | HTTP=${posted.status} | ${itemListToLabel(pendingItems)}`;
        }

        pendingItems = [];
        tapStartDate = "";
        refreshPendingList();
        renderGantt();
        form.reset();
        formEquipment.value = selectedItem?.label || "";
        formQuantity.value = "1";
    });
}

export async function initAdminReturnAlerts(config) {
    const alertsRoot = document.getElementById("admin-return-alerts");
    const tableBody = document.getElementById("admin-reservation-table-body");
    if (!alertsRoot || !tableBody) {
        return;
    }

    applySheetLinks(config, {
        master: "admin-master-sheet-link",
        reservation: "admin-reservation-sheet-link"
    });

    const today = formatDate(new Date());
    const reservationItems = await loadReservationItems(config);

    const dueItems = reservationItems.filter((item) => item.returnDate <= today);

    alertsRoot.innerHTML = "";
    if (dueItems.length === 0) {
        alertsRoot.innerHTML = "<p class='note'>本日返納期限の備品はありません。</p>";
    } else {
        dueItems.forEach((item) => {
            const p = document.createElement("p");
            p.className = "admin-alert-item";
            p.textContent = `予約ID ${item.recordId}（${item.equipmentLabel} x${item.quantity}）の返納日が来ました。`;
            alertsRoot.appendChild(p);
        });
    }

    tableBody.innerHTML = "";
    reservationItems
        .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
        .forEach((item) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${item.equipmentLabel}</td>
                <td>${item.quantity}</td>
                <td>${item.loanDate}</td>
                <td>${item.returnDate}</td>
            `;
            tableBody.appendChild(row);
        });
}
