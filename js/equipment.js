/**
 * 若松町内会ホームページ 備品予約モジュール
 *
 * - 備品マスタ管理 (Firestore equipmentMaster / config.items)
 * - 4週間空き状況ガントチャート (日別厳密残数計算)
 * - 複数備品予約カート
 * - Firestore ACIDトランザクション (runTransaction) による完全排他制御・在庫超過防止
 * - 予約ライフサイクル管理 (申請 requested → 承認 approved → 貸出 borrowed → 返納完了 returned)
 */

import { gasGet, gasPost, getGasUrl } from "./gas-api.js";
import { db, isFirebaseReady, auth } from "./firebase-init.js";
import {
    collection,
    doc,
    getDocs,
    getDoc,
    query,
    where,
    runTransaction,
    updateDoc,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATUS_CACHE_KEY = "wakamatsu_equipment_status_v1";

function normalize(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
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

/**
 * 備品マスタの読み込み (Firestore優先、フォールバックあり)
 */
async function loadEquipmentItems(config) {
    // 1. Firestore からの取得
    if (isFirebaseReady && db) {
        try {
            const masterSnap = await getDocs(collection(db, "equipmentMaster"));
            const items = [];
            masterSnap.forEach((docSnap) => {
                const data = docSnap.data();
                items.push({
                    id: docSnap.id,
                    label: data.name || docSnap.id,
                    stock: Number(data.stock || 1),
                    aliases: Array.isArray(data.aliases) ? data.aliases : []
                });
            });
            if (items.length > 0) return items;
        } catch (err) {
            console.warn("[Equipment] Firestore マスタ取得エラー:", err);
        }
    }

    // 2. config.items または デフォルト
    return config?.equipment?.items || [
        { id: "tent", label: "テント", stock: 3, aliases: ["てんと", "大型テント", "イベント"] },
        { id: "table", label: "長机", stock: 10, aliases: ["机", "つくえ", "会議机"] },
        { id: "chair", label: "椅子", stock: 30, aliases: ["いす", "パイプ椅子"] },
        { id: "generator", label: "発電機", stock: 2, aliases: ["はつでんき", "電源"] },
        { id: "mower", label: "草刈機", stock: 2, aliases: ["くさかり", "草刈り機"] }
    ];
}

/**
 * 予約台帳の読み込み (Firestore優先)
 */
async function loadReservationItems(config) {
    if (isFirebaseReady && db) {
        try {
            const q = query(
                collection(db, "equipmentReservations"),
                where("status", "in", ["requested", "approved", "borrowed"])
            );
            const snap = await getDocs(q);
            const list = [];
            snap.forEach((docSnap) => {
                const data = docSnap.data();
                list.push({
                    recordId: docSnap.id,
                    equipmentId: data.equipmentId,
                    equipmentLabel: data.equipmentName || data.equipmentLabel,
                    quantity: Number(data.quantity || 1),
                    loanDate: data.startDate || data.loanDate,
                    returnDate: data.endDate || data.returnDate,
                    status: data.status || "requested",
                    applicant: data.applicantName || data.applicant || "",
                    phone: data.phone || "",
                    group: data.group || "",
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : String(data.createdAt || "")
                });
            });
            if (list.length > 0) {
                localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(list));
                return list;
            }
        } catch (err) {
            console.warn("[Equipment] Firestore 予約一覧取得エラー:", err);
        }
    }

    // ローカルキャッシュまたはモック
    const saved = localStorage.getItem(STATUS_CACHE_KEY);
    if (saved) {
        try { return JSON.parse(saved); } catch {}
    }
    return [];
}

/**
 * 指定日の使用数量を集計
 */
function getUsedQuantity(reservations, equipmentId, dateStr) {
    return reservations
        .filter((r) => r.equipmentId === equipmentId && inRange(dateStr, r.loanDate, r.returnDate))
        .reduce((sum, r) => sum + Number(r.quantity || 1), 0);
}

/**
 * 指定期間内の最小空き在庫数を取得
 */
function getMinRemainingOnRange(reservations, equipmentId, totalStock, startDate, endDate) {
    let curr = new Date(startDate);
    const end = new Date(endDate);
    let minRemain = totalStock;

    while (curr <= end) {
        const dStr = formatDate(curr);
        const used = getUsedQuantity(reservations, equipmentId, dStr);
        minRemain = Math.min(minRemain, totalStock - used);
        curr = addDays(curr, 1);
    }
    return Math.max(0, minRemain);
}

function createGanttCell(dateStr, used, stock) {
    const cell = document.createElement("button");
    cell.type = "button";
    const remaining = Math.max(0, stock - used);
    const statusClass = remaining <= 0 ? "loaned" : remaining < stock ? "partial" : "free";
    cell.className = `gantt-cell ${statusClass}`;
    cell.dataset.date = dateStr;
    cell.dataset.remaining = String(remaining);
    cell.innerHTML = `
        <span class="gantt-day-num">${Number(dateStr.slice(8, 10))}</span>
        <span class="gantt-badge">${remaining <= 0 ? "満" : `残${remaining}`}</span>
    `;
    return cell;
}

/**
 * Firestore トランザクションによる排他制御予約
 */
async function executeReservationTransaction(applicant, phone, group, items) {
    if (!isFirebaseReady || !db) {
        throw new Error("Firebase が接続されていません。");
    }

    return await runTransaction(db, async (transaction) => {
        // 1. 各備品のマスタと現在の重複予約を確認
        const masterRefMap = new Map();
        const masterStockMap = new Map();

        for (const item of items) {
            const mRef = doc(db, "equipmentMaster", item.equipmentId);
            masterRefMap.set(item.equipmentId, mRef);
            const mSnap = await transaction.get(mRef);
            const stock = mSnap.exists() ? Number(mSnap.data().stock || 1) : 1;
            masterStockMap.set(item.equipmentId, stock);
        }

        // 2. 期間重複の既存予約を検証
        const reservationsRef = collection(db, "equipmentReservations");
        const existingSnap = await getDocs(query(
            reservationsRef,
            where("status", "in", ["requested", "approved", "borrowed"])
        ));

        const existingList = [];
        existingSnap.forEach((docSnap) => {
            const d = docSnap.data();
            existingList.push({
                equipmentId: d.equipmentId,
                quantity: Number(d.quantity || 1),
                loanDate: d.startDate || d.loanDate,
                returnDate: d.endDate || d.returnDate
            });
        });

        // 3. 在庫超過チェック
        for (const item of items) {
            const stock = masterStockMap.get(item.equipmentId) || 1;
            let checkCurr = new Date(item.loanDate);
            const checkEnd = new Date(item.returnDate);

            while (checkCurr <= checkEnd) {
                const dStr = formatDate(checkCurr);
                const used = getUsedQuantity(existingList, item.equipmentId, dStr);
                if (used + item.quantity > stock) {
                    const remain = Math.max(0, stock - used);
                    throw new Error(`「${item.equipmentLabel}」の在庫が ${dStr} に不足しています（希望: ${item.quantity}台 / 残り: ${remain}台）。`);
                }
                checkCurr = addDays(checkCurr, 1);
            }
        }

        // 4. アトミックに予約を作成
        const createdIds = [];
        const userUid = auth?.currentUser?.uid || "guest";

        for (const item of items) {
            const newDocRef = doc(collection(db, "equipmentReservations"));
            transaction.set(newDocRef, {
                equipmentId: item.equipmentId,
                equipmentName: item.equipmentLabel,
                quantity: item.quantity,
                startDate: item.loanDate,
                endDate: item.returnDate,
                userUid,
                applicantName: applicant,
                phone,
                group,
                status: "requested",
                createdAt: new Date(),
                updatedAt: new Date()
            });
            createdIds.push(newDocRef.id);
        }

        return createdIds;
    });
}

/**
 * 備品予約ページ初期化
 */
export async function initEquipmentPage(config = {}) {
    const select = document.getElementById("equipment-select");
    const searchInput = document.getElementById("equipment-search");
    const selectedNote = document.getElementById("equipment-selected-note");
    const ganttRoot = document.getElementById("equipment-gantt");
    const selectionNote = document.getElementById("gantt-selection-note");
    const timelineStartInput = document.getElementById("timeline-start-date");
    const timelineReset = document.getElementById("timeline-reset");
    const form = document.getElementById("equipment-reservation-form");
    const formEquipment = document.getElementById("reserve-equipment");
    const formQuantity = document.getElementById("reserve-quantity");
    const formLoanDate = document.getElementById("reserve-loan-date");
    const formReturnDate = document.getElementById("reserve-return-date");
    const addItemButton = document.getElementById("add-reservation-item");
    const itemsList = document.getElementById("reservation-items");
    const itemsEmpty = document.getElementById("reservation-items-empty");
    const formStatus = document.getElementById("reservation-status");

    if (!(select && searchInput && ganttRoot && form && formEquipment && formQuantity && formLoanDate && formReturnDate && addItemButton && itemsList)) {
        return;
    }

    const equipmentItems = await loadEquipmentItems(config);
    let reservationItems = await loadReservationItems(config);

    const indexedItems = equipmentItems.map((item) => ({
        ...item,
        _search: normalize(`${item.label} ${(item.aliases || []).join(" ")}`)
    }));

    let filteredItems = [...indexedItems];
    let selectedItem = indexedItems[0] || null;
    let rangeStart = getWeekStart(new Date());
    let tapStartDate = "";
    let pendingCart = [];

    function fillSelect(items) {
        select.innerHTML = "";
        items.forEach((item) => {
            const opt = document.createElement("option");
            opt.value = item.id;
            opt.textContent = `${item.label}（総数: ${item.stock}台）`;
            select.appendChild(opt);
        });
        if (selectedItem) select.value = selectedItem.id;
    }

    function refreshCartUI() {
        itemsList.innerHTML = "";
        if (pendingCart.length === 0) {
            if (itemsEmpty) itemsEmpty.classList.remove("hidden");
            return;
        }
        if (itemsEmpty) itemsEmpty.classList.add("hidden");

        pendingCart.forEach((item, index) => {
            const li = document.createElement("li");
            li.style.display = "flex";
            li.style.justifyContent = "space-between";
            li.style.alignItems = "center";
            li.style.padding = "6px 0";
            li.style.borderBottom = "1px solid #eee";

            const text = document.createElement("span");
            text.textContent = `${item.equipmentLabel} x${item.quantity}台 (${item.loanDate} 〜 ${item.returnDate})`;

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "button danger";
            delBtn.style.padding = "2px 8px";
            delBtn.style.fontSize = "0.8rem";
            delBtn.textContent = "取消";
            delBtn.addEventListener("click", () => {
                pendingCart.splice(index, 1);
                refreshCartUI();
                renderGantt();
            });

            li.append(text, delBtn);
            itemsList.appendChild(li);
        });
    }

    function renderGantt() {
        ganttRoot.innerHTML = "";
        if (!selectedItem) return;

        const stock = selectedItem.stock || 1;
        const dates = [];
        for (let i = 0; i < 28; i++) {
            dates.push(formatDate(addDays(rangeStart, i)));
        }

        // 曜日ヘッダー
        const header = document.createElement("div");
        header.className = "gantt-header";
        const emptyLabel = document.createElement("span");
        emptyLabel.className = "gantt-equipment-name";
        emptyLabel.textContent = "週 / 曜日";
        header.appendChild(emptyLabel);

        ["日", "月", "火", "水", "木", "金", "土"].forEach((w, idx) => {
            const span = document.createElement("span");
            span.textContent = w;
            if (idx === 0) span.style.color = "#c0392b";
            if (idx === 6) span.style.color = "#2980b9";
            header.appendChild(span);
        });

        // カート内の一時予約も合算して空き状況をリアルタイム計算
        const combinedReservations = [
            ...reservationItems,
            ...pendingCart.map((c) => ({
                equipmentId: c.equipmentId,
                quantity: c.quantity,
                loanDate: c.loanDate,
                returnDate: c.returnDate
            }))
        ];

        const rows = [];
        for (let week = 0; week < 4; week++) {
            const row = document.createElement("div");
            row.className = "gantt-row";

            const weekStartStr = dates[week * 7];
            const weekEndStr = dates[week * 7 + 6];
            const nameCell = document.createElement("span");
            nameCell.className = "gantt-equipment-name";
            nameCell.textContent = `${Number(weekStartStr.slice(5, 7))}/${Number(weekStartStr.slice(8, 10))}〜`;
            row.appendChild(nameCell);

            dates.slice(week * 7, week * 7 + 7).forEach((dStr) => {
                const used = getUsedQuantity(combinedReservations, selectedItem.id, dStr);
                const cell = createGanttCell(dStr, used, stock);

                cell.addEventListener("click", () => {
                    const remaining = Number(cell.dataset.remaining || "0");
                    if (remaining <= 0) {
                        selectionNote.textContent = `${dStr} は在庫なしのため選択できません。`;
                        return;
                    }

                    if (!tapStartDate || dStr < tapStartDate) {
                        tapStartDate = dStr;
                        formLoanDate.value = dStr;
                        formReturnDate.value = dStr;
                        formQuantity.max = String(remaining);
                        formQuantity.value = "1";
                        selectionNote.textContent = `貸出日を ${dStr} に設定しました。返納日をタップしてください。`;
                    } else {
                        formLoanDate.value = tapStartDate;
                        formReturnDate.value = dStr;
                        const minRemain = getMinRemainingOnRange(combinedReservations, selectedItem.id, stock, tapStartDate, dStr);
                        formQuantity.max = String(Math.max(1, minRemain));
                        formQuantity.value = String(Math.min(Number(formQuantity.value || 1), Math.max(1, minRemain)));
                        selectionNote.textContent = `期間: ${tapStartDate} 〜 ${dStr} (最小空き数: ${minRemain}台)`;
                    }
                });

                row.appendChild(cell);
            });

            rows.push(row);
        }

        ganttRoot.append(header, ...rows);
        selectedNote.textContent = `表示中: ${selectedItem.label}（総数: ${selectedItem.stock}台）`;
        formEquipment.value = selectedItem.label;
    }

    fillSelect(filteredItems);
    renderGantt();

    // 検索フィルタ
    searchInput.addEventListener("input", () => {
        const keyword = normalize(searchInput.value);
        filteredItems = indexedItems.filter((item) => item._search.includes(keyword));
        fillSelect(filteredItems);
        selectedItem = filteredItems[0] || null;
        tapStartDate = "";
        renderGantt();
    });

    select.addEventListener("change", () => {
        selectedItem = indexedItems.find((item) => item.id === select.value) || indexedItems[0] || null;
        tapStartDate = "";
        renderGantt();
    });

    if (timelineReset) {
        timelineReset.addEventListener("click", () => {
            rangeStart = getWeekStart(new Date());
            tapStartDate = "";
            renderGantt();
        });
    }

    // カート追加ボタン
    addItemButton.addEventListener("click", () => {
        if (!selectedItem) return;

        const quantity = Number(formQuantity.value || 1);
        const loanDate = formLoanDate.value;
        const returnDate = formReturnDate.value;

        if (!loanDate || !returnDate) {
            formStatus.textContent = "カレンダーから貸出日と返納日を選択してください。";
            formStatus.style.color = "#c0392b";
            return;
        }

        pendingCart.push({
            equipmentId: selectedItem.id,
            equipmentLabel: selectedItem.label,
            quantity,
            loanDate,
            returnDate
        });

        formStatus.textContent = `「${selectedItem.label} x${quantity}台」をカートに追加しました。`;
        formStatus.style.color = "#247246";
        tapStartDate = "";
        refreshCartUI();
        renderGantt();
    });

    // フォーム送信（トランザクション実行）
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (pendingCart.length === 0) {
            formStatus.textContent = "先に備品をカート（予約リスト）へ追加してください。";
            formStatus.style.color = "#c0392b";
            return;
        }

        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        const phone = String(fd.get("phone") || "").trim();
        const group = String(fd.get("group") || "").trim();

        if (!name || !phone || !group) {
            formStatus.textContent = "氏名・電話番号・組班を入力してください。";
            formStatus.style.color = "#c0392b";
            return;
        }

        formStatus.textContent = "在庫を確認し、予約トランザクションを実行中...";
        formStatus.style.color = "";

        try {
            if (isFirebaseReady && db) {
                // Firestore トランザクション
                await executeReservationTransaction(name, phone, group, pendingCart);
                formStatus.textContent = `予約申請が完了しました（${itemListToLabel(pendingCart)}）。管理者の承認後に確定します。`;
                formStatus.style.color = "#247246";
            } else {
                // GAS フォールバック
                const posted = await gasPost({
                    action: "reserveEquipment",
                    applicant: name,
                    phone,
                    group,
                    items: pendingCart.map((c) => ({
                        equipment: c.equipmentLabel,
                        equipmentId: c.equipmentId,
                        quantity: c.quantity,
                        loanDate: c.loanDate,
                        returnDate: c.returnDate
                    }))
                });
                if (posted && posted.ok !== false && !posted.error) {
                    formStatus.textContent = `予約が送信されました（${itemListToLabel(pendingCart)}）。`;
                    formStatus.style.color = "#247246";
                } else {
                    throw new Error(posted?.error || "GAS予約送信に失敗しました。");
                }
            }

            // 成功時のクリーンアップ
            pendingCart = [];
            refreshCartUI();
            reservationItems = await loadReservationItems(config);
            renderGantt();
            form.reset();
        } catch (err) {
            console.error("[Equipment] 予約エラー:", err);
            formStatus.textContent = `予約失敗: ${err.message || err}`;
            formStatus.style.color = "#c0392b";
        }
    });
}

/**
 * 管理画面用: 予約ステータス更新 (承認 / 貸出 / 返納完了 / 取消)
 */
export async function updateReservationStatus(reservationId, newStatus, note = "") {
    if (!isFirebaseReady || !db) return { ok: false, error: "Firebase未接続" };

    try {
        const resRef = doc(db, "equipmentReservations", reservationId);
        await updateDoc(resRef, {
            status: newStatus,
            notes: note,
            updatedAt: new Date()
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message || err };
    }
}

/**
 * 管理画面: 返納アラートと一覧表示
 */
export async function initAdminReturnAlerts(config) {
    const alertsRoot = document.getElementById("admin-return-alerts");
    const tableBody = document.getElementById("admin-reservation-table-body");
    if (!alertsRoot || !tableBody) return;

    const today = formatDate(new Date());
    const reservations = await loadReservationItems(config);

    // 返納期限が今日以前で、まだ返納完了になっていないもの
    const dueItems = reservations.filter((r) => r.returnDate <= today && r.status !== "returned" && r.status !== "cancelled");

    alertsRoot.innerHTML = "";
    if (dueItems.length === 0) {
        alertsRoot.innerHTML = "<p class='note'>本日返納期限の備品はありません。</p>";
    } else {
        dueItems.forEach((item) => {
            const p = document.createElement("p");
            p.className = "admin-alert-item";
            p.style.color = "#c0392b";
            p.style.fontWeight = "bold";
            p.textContent = `⚠️ 【要返納確認】${item.equipmentLabel} x${item.quantity}台（申請者: ${item.applicant || "匿名"}様 / 期限: ${item.returnDate}）`;
            alertsRoot.appendChild(p);
        });
    }

    tableBody.innerHTML = "";
    reservations.forEach((item) => {
        const row = document.createElement("tr");
        const statusMap = {
            requested: "申請中",
            approved: "承認済",
            borrowed: "貸出中",
            returned: "返納完了",
            cancelled: "取消"
        };
        row.innerHTML = `
            <td>${item.equipmentLabel}</td>
            <td>${item.quantity}</td>
            <td>${item.loanDate} 〜 ${item.returnDate}</td>
            <td>${item.applicant || "-"}</td>
            <td><span class="status-badge">${statusMap[item.status] || item.status}</span></td>
            <td>
                ${item.status === 'requested' ? `<button class="button" data-act="approve" data-id="${item.recordId}" style="padding:2px 8px;font-size:0.8rem;">承認</button>` : ''}
                ${item.status === 'approved' ? `<button class="button" data-act="borrow" data-id="${item.recordId}" style="padding:2px 8px;font-size:0.8rem;background:#2980b9;">貸出</button>` : ''}
                ${item.status === 'borrowed' ? `<button class="button" data-act="return" data-id="${item.recordId}" style="padding:2px 8px;font-size:0.8rem;background:#247246;">返納確認</button>` : ''}
            </td>
        `;

        row.querySelectorAll("button[data-act]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const act = btn.dataset.act;
                const id = btn.dataset.id;
                let nextStatus = "approved";
                if (act === "borrow") nextStatus = "borrowed";
                if (act === "return") nextStatus = "returned";
                btn.disabled = true;
                btn.textContent = "更新中...";
                await updateReservationStatus(id, nextStatus);
                await initAdminReturnAlerts(config);
            });
        });

        tableBody.appendChild(row);
    });
}
