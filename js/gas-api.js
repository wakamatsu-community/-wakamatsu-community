import { RUNTIME_CONFIG } from "./runtime-config.js?v=20260618";

export const GAS_URL = "";

function summarizeResponseText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "<empty response>";
    }
    return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function resolveGasUrl() {
    const runtimeBuildUrl = String(RUNTIME_CONFIG?.GAS_WEB_APP_URL || "").trim();
    const runtimeUrl = typeof window !== "undefined" ? String(window.GAS_URL || "").trim() : "";
    const legacyWindowUrl = typeof window !== "undefined" ? String(window.GAS_WEB_APP_URL || "").trim() : "";
    const resolved = runtimeBuildUrl || runtimeUrl || legacyWindowUrl || GAS_URL;
    if (!resolved) {
        return "";
    }
    if (resolved.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) {
        return "";
    }
    return resolved;
}

function buildGasConfigDebugContext() {
    const runtimeBuildUrl = String(RUNTIME_CONFIG?.GAS_WEB_APP_URL || "").trim();
    const runtimeUrl = typeof window !== "undefined" ? String(window.GAS_URL || "").trim() : "";
    const legacyWindowUrl = typeof window !== "undefined" ? String(window.GAS_WEB_APP_URL || "").trim() : "";
    const runtimeObjectKeys = (typeof window !== "undefined" && window.RUNTIME_CONFIG && typeof window.RUNTIME_CONFIG === "object")
        ? Object.keys(window.RUNTIME_CONFIG).join(",")
        : "<none>";
    const origin = typeof window !== "undefined" ? String(window.location?.origin || "") : "";
    const pathname = typeof window !== "undefined" ? String(window.location?.pathname || "") : "";

    return {
        runtimeBuildUrlPresent: Boolean(runtimeBuildUrl),
        windowGasUrlPresent: Boolean(runtimeUrl),
        windowGasWebAppUrlPresent: Boolean(legacyWindowUrl),
        runtimeObjectKeys,
        origin,
        pathname
    };
}

function buildLocalServeHint(ctx) {
    const isLocalOrigin = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(ctx.origin || ""));
    const hasNoRuntimeObject = String(ctx.runtimeObjectKeys || "") === "<none>";
    const isRootHtml = String(ctx.pathname || "").startsWith("/") && !String(ctx.pathname || "").startsWith("/dist/");

    if (isLocalOrigin && hasNoRuntimeObject && isRootHtml) {
        return " | hint: 現在はプロジェクト直下を配信しています。python scripts/build_pages.py --mode local 実行後、dist を配信して /dist/events.html ではなく dist ルートの /events.html を開いてください（例: cd dist; python -m http.server 8000）";
    }
    return "";
}

function throwGasUrlNotConfigured() {
    const ctx = buildGasConfigDebugContext();
    const hint = buildLocalServeHint(ctx);
    throw new Error(
        "GAS URL is not configured (GAS_WEB_APP_URL が未設定です: GitHub Secrets の GAS_WEB_APP_URL を確認してください)"
        + ` | debug: runtimeBuildUrlPresent=${ctx.runtimeBuildUrlPresent}`
        + `, windowGasUrlPresent=${ctx.windowGasUrlPresent}`
        + `, windowGasWebAppUrlPresent=${ctx.windowGasWebAppUrlPresent}`
        + `, runtimeConfigKeys=${ctx.runtimeObjectKeys}`
        + `, origin=${ctx.origin}`
        + `, path=${ctx.pathname}`
        + hint
    );
}

async function parseJsonResponse(response, requestUrl, method) {
    const rawText = await response.text();
    if (!rawText) {
        return {};
    }

    try {
        return JSON.parse(rawText);
    } catch {
        const contentType = response.headers.get("content-type") || "unknown";
        throw new Error(
            `GAS ${method} returned non-JSON response: HTTP ${response.status}, Content-Type=${contentType}, URL=${requestUrl}, Body=${summarizeResponseText(rawText)}`
        );
    }
}

export function getGasUrl() {
    return resolveGasUrl();
}

function toQueryString(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
            return;
        }
        search.set(key, String(value));
    });
    return search.toString();
}

export async function gasGet(params = {}) {
    const query = toQueryString({ ...params, _ts: Date.now() });
    const baseUrl = resolveGasUrl();
    if (!baseUrl) {
        throwGasUrlNotConfigured();
    }
    const url = query ? `${baseUrl}?${query}` : baseUrl;
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) {
        throw new Error(`GAS GET failed: ${response.status}`);
    }
    const parsed = await parseJsonResponse(response, url, "GET");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
            ...parsed,
            _httpStatus: response.status,
            _requestUrl: url
        };
    }
    return {
        data: parsed,
        _httpStatus: response.status,
        _requestUrl: url
    };
}

export async function gasPost(payload = {}) {
    const url = resolveGasUrl();
    if (!url) {
        throwGasUrlNotConfigured();
    }
    const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`GAS POST failed: ${response.status}`);
    }
    const parsed = await parseJsonResponse(response, url, "POST");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
            ...parsed,
            _httpStatus: response.status,
            _requestUrl: url
        };
    }
    return {
        data: parsed,
        _httpStatus: response.status,
        _requestUrl: url
    };
}

export async function gasPostForm(formData) {
    const payload = {};
    if (formData && typeof formData.entries === "function") {
        for (const [key, value] of formData.entries()) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) {
                const prev = payload[key];
                payload[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
            } else {
                payload[key] = value;
            }
        }
    }
    return gasPost(payload);
}
