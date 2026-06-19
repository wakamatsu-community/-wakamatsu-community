/**
 * 写真アルバム表示モジュール
 *
 * 表示元は GAS(getGallery) の写真メタデータを正とし、
 * 取得失敗時のみ mockPhotos を使用します。
 */

import { gasGet, gasPost, getGasUrl } from "./gas-api.js";

function createDriveFileUrls(file) {
    const fileId = file.id || "";
    return {
        viewUrl: file.viewUrl || file.webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : "#"),
        downloadUrl: file.downloadUrl || file.webContentLink || (fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : "#"),
        thumbnailUrl: file.thumbnailUrl || file.thumbnailLink || ""
    };
}

function normalizeDriveFiles(data) {
    const rawFiles = Array.isArray(data) ? data : (Array.isArray(data?.files) ? data.files : []);
    return rawFiles
        .map((file) => {
            const name = String(file?.name || file?.title || "").trim();
            if (!name) {
                return null;
            }
            const urls = createDriveFileUrls(file);
            return {
                id: String(file?.id || ""),
                title: name,
                comment: String(file?.comment || file?.description || file?.metadataComment || "").trim(),
                viewUrl: urls.viewUrl,
                downloadUrl: urls.downloadUrl,
                thumbnailUrl: urls.thumbnailUrl
            };
        })
        .filter(Boolean);
}

function isConfiguredFolderId(folderId) {
    return Boolean(folderId && !String(folderId).includes("sample-"));
}

function toDriveFolderUrl(folderId) {
    return isConfiguredFolderId(folderId) ? `https://drive.google.com/drive/folders/${folderId}` : "";
}

async function getDrivePhotos(config, folderId) {
    if (!folderId) {
        return null;
    }

    try {
        const payload = await gasGet({ action: "getGallery" });
        const rows = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
                ? payload.data
                : [];

        const filtered = rows.filter((row) => {
            const album = String(row?.["アルバム名/カテゴリ"] || "").trim();
            return album === String(folderId).trim();
        }).map((row) => ({
            id: String(row?.["ドライブのファイルID"] || ""),
            title: String(row?.["ファイル名"] || row?.["写真ID"] || "写真"),
            comment: String(row?.["コメント/説明"] || ""),
            viewUrl: String(row?.["画像URL"] || ""),
            downloadUrl: String(row?.["画像URL"] || ""),
            thumbnailUrl: String(row?.["画像URL"] || "")
        }));

        return normalizeDriveFiles({ files: filtered });
    } catch {
        return [];
    }
}

function createPhotoGrid(photos) {
    const grid = document.createElement("div");
    grid.className = "photo-grid";

    if (!photos || photos.length === 0) {
        const empty = document.createElement("p");
        empty.className = "note";
        empty.textContent = "このフォルダに写真はまだありません。";
        grid.appendChild(empty);
        return grid;
    }

    photos.forEach((photo) => {
        if (photo.thumbnailUrl) {
            const item = document.createElement("article");
            item.className = "photo-item";

            const link = document.createElement("a");
            link.href = photo.viewUrl || "#";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "photo-thumb";

            const img = document.createElement("img");
            img.src = photo.thumbnailUrl;
            img.alt = photo.title;
            img.loading = "lazy";
            link.appendChild(img);

            const caption = document.createElement("p");
            caption.className = "photo-title";
            caption.textContent = photo.title;

            if (photo.comment) {
                const memo = document.createElement("p");
                memo.className = "photo-comment";
                memo.textContent = photo.comment;
                item.append(link, caption, memo);
            } else {
                item.append(link, caption);
            }

            const actions = document.createElement("p");
            actions.className = "photo-actions";

            const view = document.createElement("a");
            view.href = photo.viewUrl || "#";
            view.target = "_blank";
            view.rel = "noopener noreferrer";
            view.textContent = "表示";

            const sep = document.createElement("span");
            sep.textContent = " / ";

            const dl = document.createElement("a");
            dl.href = photo.downloadUrl || photo.viewUrl || "#";
            dl.target = "_blank";
            dl.rel = "noopener noreferrer";
            dl.textContent = "ダウンロード";

            actions.append(view, sep, dl);
            item.append(actions);
            grid.appendChild(item);
            return;
        }

        const placeholder = document.createElement("div");
        placeholder.className = "photo-placeholder";
        placeholder.textContent = photo.title;
        placeholder.setAttribute("aria-label", photo.title);
        grid.appendChild(placeholder);
    });

    return grid;
}

function createAlbumCard(album, photos, sourceLabel) {
    const article = document.createElement("article");
    article.className = "card gallery-album";
    article.dataset.albumTitle = (album.title || "").toLowerCase();
    article.dataset.searchText = [
        album.title || "",
        album.description || "",
        ...(photos || []).map((photo) => `${photo.title || ""} ${photo.comment || ""}`)
    ].join(" ").toLowerCase();

    const header = document.createElement("div");
    header.className = "album-header";

    const heading = document.createElement("h2");
    heading.textContent = `${album.coverEmoji || "📷"} ${album.title}`;

    const meta = document.createElement("p");
    meta.className = "note";
    meta.textContent = `${album.year}年 ・ ${photos.length}件 ・ ${sourceLabel}`;

    header.append(heading, meta);

    const desc = document.createElement("p");
    desc.textContent = album.description;
    desc.style.margin = "10px 0 14px";

    const photoGrid = createPhotoGrid(photos);

    const folderUrl = toDriveFolderUrl(album.driveFolderId);
    if (folderUrl) {
        const driveLink = document.createElement("a");
        driveLink.className = "button-link";
        driveLink.href = folderUrl;
        driveLink.target = "_blank";
        driveLink.rel = "noopener noreferrer";
        driveLink.textContent = "フォルダを開く";
        article.append(header, desc, photoGrid, driveLink);
    } else {
        const driveDisabled = document.createElement("p");
        driveDisabled.className = "note";
        driveDisabled.textContent = "フォルダID未設定のためリンクを表示できません。config.js の driveFolderId を実フォルダIDへ更新してください。";
        article.append(header, desc, photoGrid, driveDisabled);
    }

    return article;
}

async function uploadPhotosToDrive(config, payload) {
    const requestUrl = getGasUrl();

    try {
        let last = null;
        for (const file of payload.files) {
            const fileData = await fileToDataUrl(file);
            last = await gasPost({
                action: "uploadPhoto",
                fileName: file.name,
                mimeType: file.type || "image/jpeg",
                photoData: fileData,
                folderId: payload.folderId,
                uploaderName: payload.uploaderName,
                comment: payload.comment,
                album: payload.folderId
            });

            const hasBusinessError = last && (
                last.ok === false
                || last.success === false
                || last.result === false
                || last.isError === true
                || Boolean(last.error)
            );
            if (hasBusinessError) {
                return {
                    ok: false,
                    url: String(last?._requestUrl || requestUrl),
                    status: Number(last?._httpStatus || 200),
                    error: String(last?.error || last?.message || "GASから失敗応答が返されました。")
                };
            }
        }

        return {
            ok: true,
            url: String(last?._requestUrl || requestUrl),
            status: Number(last?._httpStatus || 200),
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

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました。"));
        reader.readAsDataURL(file);
    });
}

async function createGalleryFolder(payload) {
    const requestUrl = getGasUrl();

    try {
        const response = await gasPost({
            action: "createPhotoFolder",
            folderName: payload.folderName,
            parentFolderId: payload.parentFolderId,
            uploaderName: payload.uploaderName
        });

        const data = (response && typeof response.data === "object" && response.data) ? response.data : response;
        const hasBusinessError = data && (
            data.ok === false
            || data.success === false
            || data.result === false
            || data.isError === true
            || Boolean(data.error)
        );
        if (hasBusinessError) {
            return {
                ok: false,
                url: String(response?._requestUrl || requestUrl),
                status: Number(response?._httpStatus || 200),
                error: String(data?.error || data?.message || "フォルダ作成に失敗しました。"),
                folderId: ""
            };
        }

        return {
            ok: true,
            url: String(response?._requestUrl || requestUrl),
            status: Number(response?._httpStatus || 200),
            error: "",
            folderId: String(data?.folderId || ""),
            folderName: String(data?.folderName || payload.folderName || "")
        };
    } catch (error) {
        return {
            ok: false,
            url: requestUrl,
            status: 0,
            error: String(error && error.message || error),
            folderId: ""
        };
    }
}

function bindGalleryUploadForm(config, onUploaded) {
    const form = document.getElementById("gallery-upload-form");
    const destinationSelect = document.getElementById("gallery-destination");
    const newFolderWrap = document.getElementById("new-folder-wrap");
    const newFolderInput = document.getElementById("new-folder-name");
    const status = document.getElementById("gallery-upload-status");
    if (!form || !destinationSelect || !newFolderWrap || !newFolderInput || !status) {
        return;
    }

    const destinations = config?.gallery?.destinations || [];
    destinations.forEach((dest) => {
        const option = document.createElement("option");
        option.value = dest.id;
        option.textContent = dest.label;
        destinationSelect.appendChild(option);
    });

    destinationSelect.addEventListener("change", () => {
        const isNew = destinationSelect.value === "new";
        newFolderWrap.classList.toggle("hidden", !isNew);
        newFolderInput.required = isNew;
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fd = new FormData(form);

        const uploaderName = String(fd.get("uploaderName") || "").trim();
        const destination = String(fd.get("destination") || "");
        const newFolderName = String(fd.get("newFolderName") || "").trim();
        const comment = String(fd.get("comment") || "").trim();
        const files = (fd.getAll("photos") || []).filter((f) => f instanceof File && f.size > 0);

        if (!uploaderName || !destination || files.length === 0) {
            status.textContent = "投稿者名・保存先・写真ファイルを入力してください。";
            return;
        }

        let folderId = "";
        if (destination === "new") {
            if (!newFolderName) {
                status.textContent = "新規フォルダ名を入力してください。";
                return;
            }

            const sharedDestination = destinations.find((d) => d.id === "shared");
            const created = await createGalleryFolder({
                folderName: newFolderName,
                parentFolderId: String(sharedDestination?.folderId || "").trim(),
                uploaderName
            });
            if (!created.ok || !created.folderId) {
                status.textContent = `【フォルダ作成失敗】URL: ${created.url} | エラー内容: HTTP=${created.status || "N/A"} / ${created.error}`;
                return;
            }
            folderId = created.folderId;
        } else {
            const matched = destinations.find((d) => d.id === destination);
            folderId = matched?.folderId || "";
            if (!folderId) {
                status.textContent = "保存先フォルダが見つかりません。";
                return;
            }
        }

        const uploaded = await uploadPhotosToDrive(config, {
            folderId,
            uploaderName,
            comment,
            files
        });

        if (!uploaded.ok) {
            status.textContent = `【通信失敗】URL: ${uploaded.url} | エラー内容: HTTP=${uploaded.status || "N/A"} / ${uploaded.error}`;
            return;
        }

        status.textContent = `送信成功: URL=${uploaded.url} | HTTP=${uploaded.status}`;
        form.reset();
        newFolderWrap.classList.add("hidden");
        newFolderInput.required = false;
        if (typeof onUploaded === "function") {
            await onUploaded();
        }
    });
}

async function buildAlbumsForRender(config, albums) {
    const results = await Promise.all(albums.map(async (album) => {
        const drivePhotos = await getDrivePhotos(config, album.driveFolderId);
        if (drivePhotos !== null) {
            return {
                album,
                photos: drivePhotos,
                sourceLabel: "Drive"
            };
        }

        return {
            album,
            photos: (album.mockPhotos || []).map((photo) => ({
                title: photo.title || "",
                viewUrl: "",
                downloadUrl: "",
                thumbnailUrl: ""
            })),
            sourceLabel: "モック"
        };
    }));

    return results;
}

/**
 * ギャラリーページを初期化します。
 */
export function initGalleryPage(config) {
    const container = document.getElementById("gallery-root");
    if (!container) return;

    const albums = config?.gallery?.albums ?? [];
    const albumFilter = document.getElementById("gallery-album-filter");
    const searchInput = document.getElementById("gallery-search");
    const emptyState = document.getElementById("gallery-empty");

    let cards = [];

    const applyFilters = () => {
        const selectedAlbum = albumFilter?.value || "all";
        const keyword = (searchInput?.value || "").trim().toLowerCase();
        let visibleCount = 0;

        cards.forEach((card) => {
            const titleText = card.dataset.albumTitle || "";
            const searchText = card.dataset.searchText || "";
            const byAlbum = selectedAlbum === "all" || titleText === selectedAlbum.toLowerCase();
            const byKeyword = keyword === "" || searchText.includes(keyword);
            const visible = byAlbum && byKeyword;
            card.classList.toggle("hidden", !visible);
            if (visible) {
                visibleCount += 1;
            }
        });

        if (emptyState) {
            emptyState.classList.toggle("hidden", visibleCount > 0);
        }
    };

    const renderAlbums = async () => {
        if (albums.length === 0) {
            container.innerHTML = "<section class='card'><p>アルバムは準備中です。</p></section>";
            cards = [];
            applyFilters();
            return;
        }

        if (albumFilter) {
            const selected = albumFilter.value || "all";
            albumFilter.innerHTML = "<option value='all'>すべてのアルバム</option>";
            albums.forEach((album) => {
                const option = document.createElement("option");
                option.value = album.title;
                option.textContent = album.title;
                albumFilter.appendChild(option);
            });
            albumFilter.value = selected;
        }

        container.innerHTML = "";
        const albumData = await buildAlbumsForRender(config, albums);
        cards = albumData.map(({ album, photos, sourceLabel }) => {
            const card = createAlbumCard(album, photos, sourceLabel);
            container.appendChild(card);
            return card;
        });

        applyFilters();
    };

    albumFilter?.addEventListener("change", applyFilters);
    searchInput?.addEventListener("input", applyFilters);
    bindGalleryUploadForm(config, renderAlbums);
    renderAlbums();
}
