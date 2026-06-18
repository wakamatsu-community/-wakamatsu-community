import { RUNTIME_CONFIG } from "./runtime-config.js?v=20260618";

export const GAS_URL = "";

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

function throwGasUrlNotConfigured() {
    throw new Error("GAS URL is not configured (GAS_WEB_APP_URL が未設定です: GitHub Secrets の GAS_WEB_APP_URL を確認してください)");
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
    const query = toQueryString(params);
    const baseUrl = resolveGasUrl();
    if (!baseUrl) {
        throwGasUrlNotConfigured();
    }
    const url = query ? `${baseUrl}?${query}` : baseUrl;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
        throw new Error(`GAS GET failed: ${response.status}`);
    }
    return response.json();
}

export async function gasPost(payload = {}) {
    const url = resolveGasUrl();
    if (!url) {
        throwGasUrlNotConfigured();
    }
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`GAS POST failed: ${response.status}`);
    }
    const parsed = await response.json().catch(() => ({}));
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
