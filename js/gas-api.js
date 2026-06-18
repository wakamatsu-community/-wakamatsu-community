import { RUNTIME_CONFIG } from "./runtime-config.js";

export const GAS_URL = "";

function resolveGasUrl() {
    const runtimeBuildUrl = String(RUNTIME_CONFIG?.GAS_WEB_APP_URL || "").trim();
    const runtimeUrl = typeof window !== "undefined" ? String(window.GAS_URL || "").trim() : "";
    return runtimeBuildUrl || runtimeUrl || GAS_URL;
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
        throw new Error("GAS URL is not configured");
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
        throw new Error("GAS URL is not configured");
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
    const url = resolveGasUrl();
    if (!url) {
        throw new Error("GAS URL is not configured");
    }
    const response = await fetch(url, {
        method: "POST",
        body: formData
    });
    if (!response.ok) {
        throw new Error(`GAS POST(form) failed: ${response.status}`);
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
