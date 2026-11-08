/**
 * 若松町内会ホームページ 意見交換・地域相談モジュール
 *
 * - 会員・住民による意見・相談投稿 (全体公開 / 役員相談)
 * - Cloud Firestore (opinions) による完全リアルタイム共有 (localStorage孤立の解消)
 * - 管理者による返答・ステータス更新 (未確認 / 検討中 / 対応中 / 解消 / その他)
 * - フォールバック機能 (GAS API)
 */

import { gasGet, gasPost, getGasUrl } from "./gas-api.js";
import { db, isFirebaseReady, auth } from "./firebase-init.js";
import {
    collection,
    doc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const OPINION_STORE_KEY = "wakamatsu_opinion_exchange_v1";
const OPINION_STATUS_UNCONFIRMED = "未確認";
const OPINION_STATUS_OPTIONS = ["検討中", "対応中", "解消", "その他"];

function normalizeOpinionStatus(value) {
    const raw = String(value || "").trim();
    if (raw === "保留") return "その他";
    if (raw === OPINION_STATUS_UNCONFIRMED || OPINION_STATUS_OPTIONS.includes(raw)) {
        return raw;
    }
    return OPINION_STATUS_UNCONFIRMED;
}

function normalizeOpinion(opinion) {
    const status = normalizeOpinionStatus(opinion?.status);
    return {
        ...opinion,
        status,
        answered: Boolean(opinion?.answered),
        reason: status === OPINION_STATUS_UNCONFIRMED ? "" : String(opinion?.reason || opinion?.reply || "").trim()
    };
}

function loadLocalOpinions() {
    const saved = localStorage.getItem(OPINION_STORE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed.map(normalizeOpinion) : [];
        } catch {
            localStorage.removeItem(OPINION_STORE_KEY);
        }
    }
    return [];
}

function saveLocalOpinions(opinions) {
    // 要件10: 非公開相談はローカルキャッシュに保存せず、公開意見のみを安全に保持
    const publicOnly = (opinions || []).filter((op) => op.isPublic !== false);
    localStorage.setItem(OPINION_STORE_KEY, JSON.stringify(publicOnly));
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getOpinionStatusText(opinion) {
    const status = normalizeOpinionStatus(opinion?.status);
    const reason = String(opinion?.reason || opinion?.reply || "").trim();
    if (status !== OPINION_STATUS_UNCONFIRMED && reason) {
        return `${status} - ${reason}`;
    }
    return status;
}

/**
 * 意見一覧の読み込み (Firestore優先)
 */
export async function fetchOpinions() {
    if (isFirebaseReady && db) {
        try {
            const opinionsRef = collection(db, "opinions");
            const q = query(opinionsRef, orderBy("createdAt", "desc"));
            const snap = await getDocs(q);
            const list = [];
            snap.forEach((docSnap) => {
                const data = docSnap.data();
                const createdAtIso = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : String(data.createdAt || "");
                list.push(normalizeOpinion({
                    id: docSnap.id,
                    name: data.name || "匿名",
                    category: data.category || "未分類",
                    content: data.content || "",
                    isPublic: data.isPublic !== false,
                    status: data.status || "未確認",
                    answered: Boolean(data.answered || data.reply),
                    reason: data.reply || data.reason || "",
                    createdAt: createdAtIso,
                    updatedAt: createdAtIso
                }));
            });
            if (list.length > 0) {
                saveLocalOpinions(list);
                return list;
            }
        } catch (err) {
            console.warn("[Opinion] Firestore 取得エラー:", err);
        }
    }

    // フォールバック: GAS
    try {
        const payload = await gasGet({ action: "getOpinions" });
        const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
        if (rows.length > 0) {
            const list = rows.map((row, idx) => normalizeOpinion({
                id: String(row?.["投稿ID"] || `OP-${Date.now()}-${idx}`),
                name: String(row?.["名前"] || "").trim(),
                category: String(row?.["カテゴリ"] || "").trim(),
                content: String(row?.["内容"] || "").trim(),
                answered: String(row?.["返信状態"] || "") !== "未対応",
                status: String(row?.["管理ステータス"] || "未確認"),
                reason: String(row?.["返信状態"] || "").trim(),
                createdAt: String(row?.["日時"] || ""),
                updatedAt: String(row?.["日時"] || "")
            })).filter((item) => item.content);
            saveLocalOpinions(list);
            return list;
        }
    } catch {}

    return loadLocalOpinions();
}

/**
 * 意見カードの描画 (一般住民用)
 */
function renderOpinionEntries(listEl, opinions) {
    if (!listEl) return;

    // 全体公開のもののみ表示
    const publicOpinions = opinions.filter((o) => o.isPublic !== false);

    if (publicOpinions.length === 0) {
        listEl.innerHTML = "<p class=\"note\">現在、公開されている投稿はありません。</p>";
        return;
    }

    listEl.innerHTML = "";
    publicOpinions.forEach((opinion) => {
        const card = document.createElement("article");
        card.className = "card opinion-entry-card";
        const currentStatus = normalizeOpinionStatus(opinion.status);
        card.innerHTML = `
            <div class="opinion-entry-meta" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
                <span class="status-badge" data-status="${escapeHtml(currentStatus)}" style="padding:2px 8px;border-radius:4px;font-size:0.85rem;background:#eee;">${escapeHtml(currentStatus)}</span>
                <span class="note">${escapeHtml(opinion.category || "未分類")}</span>
                <span class="note">${formatDate(opinion.updatedAt || opinion.createdAt)}</span>
            </div>
            <h3 style="margin-top:0;">${escapeHtml(opinion.content)}</h3>
            <p><strong>名前:</strong> ${escapeHtml(opinion.name || "匿名")}</p>
            ${opinion.answered ? '<p><strong>回答状況:</strong> あり</p>' : ""}
            <div style="background:#f9f9f9;padding:10px;border-radius:6px;margin-top:8px;">
                <strong>役員・管理者の返答:</strong>
                <p style="margin:4px 0 0;">${escapeHtml(getOpinionStatusText(opinion))}</p>
            </div>
        `;
        listEl.appendChild(card);
    });
}

/**
 * 意見の新規送信 (要件11: ログインユーザーUIDの厳格照合)
 */
export async function submitOpinion(record, photoFile = null) {
    if (isFirebaseReady && db) {
        const userUid = auth?.currentUser?.uid;
        if (!userUid) {
            return { ok: false, error: "ご意見・ご相談の送信にはログインが必要です。" };
        }
        try {
            await addDoc(collection(db, "opinions"), {
                name: record.name || "匿名",
                category: record.category,
                content: record.content,
                isPublic: record.isPublic !== false,
                status: "未確認",
                reply: "",
                answered: false,
                userUid,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            return { ok: true };
        } catch (err) {
            console.error("[Opinion] Firestore 投稿エラー:", err);
            return { ok: false, error: err.message || err };
        }
    }

    // GAS フォールバック
    try {
        const response = await gasPost({
            action: "addOpinion",
            name: record.name,
            category: record.category,
            content: record.content,
            isPublic: record.isPublic !== false
        });
        if (response && response.ok !== false && !response.error) {
            return { ok: true };
        }
        return { ok: false, error: response?.error || "GAS送信に失敗しました。" };
    } catch (err) {
        return { ok: false, error: String(err.message || err) };
    }
}

/**
 * 管理者によるステータス・返答更新
 */
export async function updateOpinionByAdmin(opinionId, status, replyContent, answered = true) {
    if (isFirebaseReady && db) {
        try {
            const opRef = doc(db, "opinions", opinionId);
            await updateDoc(opRef, {
                status: normalizeOpinionStatus(status),
                reply: replyContent,
                answered: Boolean(answered),
                replyAt: new Date(),
                updatedAt: new Date()
            });
            return { ok: true };
        } catch (err) {
            console.error("[Opinion] Firestore 更新エラー:", err);
            return { ok: false, error: err.message || err };
        }
    }

    return { ok: false, error: "Firestore未接続のため更新できません。" };
}

/**
 * 一般画面 (opinion.html) の初期化
 */
export async function initOpinionExchangePage(config = {}) {
    const list = document.getElementById("opinion-list");
    const form = document.getElementById("opinion-form");
    const status = document.getElementById("opinion-form-status");

    if (!list) return;

    const opinions = await fetchOpinions();
    renderOpinionEntries(list, opinions);

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(form);

            const record = {
                name: String(fd.get("name") || "").trim(),
                category: String(fd.get("category") || "").trim(),
                content: String(fd.get("content") || "").trim(),
                isPublic: fd.get("isPublic") !== "false"
            };

            if (!record.category || !record.content) {
                if (status) status.textContent = "カテゴリと相談内容を入力してください。";
                return;
            }

            if (status) status.textContent = "送信中...";

            const res = await submitOpinion(record);
            if (res.ok) {
                if (status) {
                    status.textContent = "ご意見・ご相談を投稿しました。ありがとうございます。";
                    status.style.color = "#247246";
                }
                form.reset();
                const updated = await fetchOpinions();
                renderOpinionEntries(list, updated);
            } else {
                if (status) {
                    status.textContent = `送信失敗: ${res.error}`;
                    status.style.color = "#c0392b";
                }
            }
        });
    }
}

/**
 * 管理画面 (admin.html) の意見管理初期化
 */
export async function initAdminOpinionExchange(config = {}) {
    const root = document.getElementById("admin-opinion-list");
    const status = document.getElementById("admin-opinion-status");
    if (!root) return;

    const opinions = await fetchOpinions();
    if (status) status.textContent = `投稿 ${opinions.length}件 を読み込みました。`;

    root.innerHTML = "";
    if (opinions.length === 0) {
        root.innerHTML = "<p class='note'>管理対象の投稿はありません。</p>";
        return;
    }

    opinions.forEach((opinion) => {
        const card = document.createElement("article");
        card.className = "card opinion-admin-card";
        card.style.marginBottom = "16px";
        card.dataset.opinionId = opinion.id;

        const currentStatus = normalizeOpinionStatus(opinion.status);
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span class="status-badge" style="padding:2px 8px;border-radius:4px;background:#eee;">${escapeHtml(currentStatus)}</span>
                <span class="note">${escapeHtml(opinion.category || "未分類")} / ${formatDate(opinion.updatedAt || opinion.createdAt)}</span>
            </div>
            <h3 style="margin-top:0;">${escapeHtml(opinion.content)}</h3>
            <p><strong>投稿者:</strong> ${escapeHtml(opinion.name || "匿名")} (${opinion.isPublic ? "全体公開" : "🔒 役員相談"})</p>
            <form class="opinion-admin-form" style="background:#fcfcfc;padding:12px;border-radius:6px;border:1px solid #ddd;">
                <label style="display:block;margin-bottom:8px;">対応ステータス:
                    <select name="status" style="margin-left:8px;">
                        <option value="未確認" ${currentStatus === '未確認' ? 'selected' : ''}>未確認</option>
                        <option value="検討中" ${currentStatus === '検討中' ? 'selected' : ''}>検討中</option>
                        <option value="対応中" ${currentStatus === '対応中' ? 'selected' : ''}>対応中</option>
                        <option value="解消" ${currentStatus === '解消' ? 'selected' : ''}>解消</option>
                        <option value="その他" ${currentStatus === 'その他' ? 'selected' : ''}>その他</option>
                    </select>
                </label>
                <label style="display:block;margin-bottom:8px;">返答・対応内容:
                    <textarea name="reply" rows="2" style="width:100%;box-sizing:border-box;">${escapeHtml(opinion.reason || "")}</textarea>
                </label>
                <button class="button" type="submit" style="padding:4px 12px;">返答を保存して他端末へ反映</button>
                <span class="save-status note" style="margin-left:8px;"></span>
            </form>
        `;

        const form = card.querySelector(".opinion-admin-form");
        const saveStatus = card.querySelector(".save-status");

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const nextStatus = fd.get("status");
            const reply = String(fd.get("reply") || "").trim();

            saveStatus.textContent = "保存中...";
            saveStatus.style.color = "";

            const res = await updateOpinionByAdmin(opinion.id, nextStatus, reply, Boolean(reply));
            if (res.ok) {
                saveStatus.textContent = "保存完了！他端末にも即時反映されます。";
                saveStatus.style.color = "#247246";
            } else {
                saveStatus.textContent = `保存失敗: ${res.error}`;
                saveStatus.style.color = "#c0392b";
            }
        });

        root.appendChild(card);
    });
}
