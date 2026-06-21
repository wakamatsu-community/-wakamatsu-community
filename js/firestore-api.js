function buildQueryString(params = {}) {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
            return;
        }

        if (Array.isArray(value)) {
            searchParams.set(key, value.join(","));
            return;
        }

        searchParams.set(key, String(value));
    });

    return searchParams.toString();
}

async function parseJsonResponse(response, url) {
    const text = await response.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Firestore API returned non-JSON response: HTTP ${response.status}, URL=${url}`);
    }
}

export async function fetchFirestoreCollection(collectionName, options = {}) {
    const query = buildQueryString(options);
    const url = query ? `/api/firestore/${encodeURIComponent(collectionName)}?${query}` : `/api/firestore/${encodeURIComponent(collectionName)}`;
    const response = await fetch(url, { method: "GET", cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Firestore API GET failed: HTTP ${response.status}`);
    }

    const parsed = await parseJsonResponse(response, url);
    return {
        ...(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { data: parsed }),
        _httpStatus: response.status,
        _requestUrl: url
    };
}

export async function fetchFirestoreDocument(collectionName, documentId) {
    const url = `/api/firestore/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}`;
    const response = await fetch(url, { method: "GET", cache: "no-store" });

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`Firestore API GET failed: HTTP ${response.status}`);
    }

    return parseJsonResponse(response, url);
}