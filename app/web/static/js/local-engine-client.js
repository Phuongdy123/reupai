(function () {
    'use strict';

    const engineUrl = (
        window.REUP_LOCAL_ENGINE_URL
        || 'http://127.0.0.1:17888'
    ).replace(/\/$/, '');
    const tokenKey = 'reupai.local-engine.session';
    const grantKey = 'reupai.local-engine.grant';
    const stateKey = 'reupai.local-engine.state';
    const requestTimeoutMs = 30000;
    const listeners = new Set();
    const state = { status: 'disconnected', error: null };

    function emit(status, error) {
        state.status = status;
        state.error = error || null;
        listeners.forEach((listener) => listener({ ...state }));
        window.dispatchEvent(new CustomEvent('reupai:connection', { detail: { ...state } }));
    }

    function token() {
        return window.localStorage.getItem(tokenKey);
    }

    function grant() {
        return window.localStorage.getItem(grantKey);
    }

    function mapPath(path) {
        const value = String(path || '');
        if (value === '/api/jobs/active') return '/api/jobs';
        const processMatch = value.match(/^\/api\/process\/([^/?]+)(?:\?(.*))?$/);
        if (processMatch) return `/api/jobs/${processMatch[1]}${processMatch[2] ? `?${processMatch[2]}` : ''}`;
        const stopMatch = value.match(/^\/api\/process\/([^/]+)\/stop(?:\?(.*))?$/);
        if (stopMatch) return `/api/jobs/${stopMatch[1]}/stop${stopMatch[2] ? `?${stopMatch[2]}` : ''}`;
        return value;
    }

    async function fetchWithTimeout(url, options = {}, fallbackTimeout = requestTimeoutMs) {
        const { timeoutMs, signal, ...fetchOptions } = options;
        if (signal) return window.fetch(url, { ...fetchOptions, signal });
        const duration = Number(timeoutMs ?? fallbackTimeout);
        if (!Number.isFinite(duration) || duration <= 0) return window.fetch(url, fetchOptions);
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), duration);
        try {
            return await window.fetch(url, { ...fetchOptions, signal: controller.signal });
        } finally {
            window.clearTimeout(timer);
        }
    }

    async function responseError(response, fallback) {
        let detail = '';
        try {
            const data = await response.json();
            detail = typeof data?.detail === 'string' ? data.detail : '';
        } catch (_) { /* Empty or non-JSON responses are handled below. */ }
        const error = new Error(detail || `${fallback || 'Local Engine không thể hoàn tất yêu cầu.'} (HTTP ${response.status}).`);
        error.status = response.status;
        return error;
    }

    async function request(path, options = {}) {
        const headers = new Headers(options.headers || {});
        const currentToken = token();
        if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);
        const response = await fetchWithTimeout(`${engineUrl}${mapPath(path)}`, { cache: 'no-store', ...options, headers });
        if (response.status === 401) emit('authorization_required');
        return response;
    }

    async function json(path, options) {
        const response = await request(path, options);
        let data = {};
        try { data = await response.json(); } catch (_) { data = {}; }
        if (!response.ok) {
            const error = new Error(data.detail || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    async function check() {
        emit('checking');
        try {
            const healthResponse = await fetchWithTimeout(`${engineUrl}/api/health`, { cache: 'no-store', timeoutMs: 8000 });
            if (!healthResponse.ok) throw await responseError(healthResponse, 'Không thể kiểm tra Local Engine');
            const health = await healthResponse.json().catch(() => ({}));
            if (!health?.capabilities?.direct_authorization) {
                throw Object.assign(new Error('Local Engine đang là bản cũ. Hãy cập nhật để kết nối một chạm.'), { code: 'engine_update_required' });
            }
            let status = await request('/api/status', { cache: 'no-store' });
            if (status.status === 401 && grant()) {
                const refreshed = await fetchWithTimeout(`${engineUrl}/api/authorize/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_origin: window.location.origin, grant: grant() }),
                    timeoutMs: 8000,
                });
                if (refreshed.ok) {
                    const data = await refreshed.json();
                    window.localStorage.setItem(tokenKey, data.session_token);
                    status = await request('/api/status', { cache: 'no-store' });
                } else if (refreshed.status === 401 || refreshed.status === 403) {
                    window.localStorage.removeItem(tokenKey);
                    window.localStorage.removeItem(grantKey);
                    emit('authorization_required');
                    return false;
                }
            }
            if (status.status === 401) { emit('authorization_required'); return false; }
            if (!status.ok) throw new Error(`Status HTTP ${status.status}`);
            emit('connected');
            return true;
        } catch (error) {
            if (['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) || /fetch|network/i.test(error.message || '')) emit('disconnected', error);
            else if (error.code === 'engine_update_required') emit('update_required', error);
            else emit('error', error);
            return false;
        }
    }

    async function connect() {
        emit('authorizing');
        try {
            const response = await fetchWithTimeout(`${engineUrl}/api/authorize/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_origin: window.location.origin }),
                timeoutMs: 8000,
            });
            if (response.status === 404) {
                throw Object.assign(new Error('Local Engine đang là bản cũ. Hãy cập nhật để kết nối một chạm.'), { code: 'engine_update_required' });
            }
            if (!response.ok) throw await responseError(response, 'Không thể cấp quyền Local Engine');
            const data = await response.json();
            window.localStorage.setItem(tokenKey, data.session_token);
            window.localStorage.setItem(grantKey, data.grant);
            return await check();
        } catch (error) {
            if (['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) || /fetch|network/i.test(error.message || '')) emit('disconnected', error);
            else if (error.code === 'engine_update_required') emit('update_required', error);
            else emit(error.status === 403 ? 'permission_denied' : 'error', error);
            return false;
        }
    }

    async function completeCallback() {
        const query = new URLSearchParams(window.location.search);
        const code = query.get('code');
        const returnedState = query.get('state');
        const expectedState = window.sessionStorage.getItem(stateKey);
        if (!code) return false;
        if (!returnedState || returnedState !== expectedState) {
            emit('permission_denied', new Error('Authorization state không hợp lệ.'));
            return false;
        }
        emit('authorizing');
        try {
            const response = await fetchWithTimeout(`${engineUrl}/api/authorize/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, client_origin: window.location.origin }),
                timeoutMs: 8000,
            });
            if (!response.ok) throw await responseError(response, 'Không thể hoàn tất kết nối Local Engine');
            const data = await response.json();
            window.localStorage.setItem(tokenKey, data.session_token);
            if (data.grant) window.localStorage.setItem(grantKey, data.grant);
            window.sessionStorage.removeItem(stateKey);
            const clean = `${window.location.pathname}${window.location.hash || ''}`;
            window.history.replaceState({}, document.title, clean);
            await check();
            return true;
        } catch (error) {
            emit(error.status === 403 ? 'permission_denied' : 'error', error);
            return false;
        }
    }

    async function revoke() {
        try {
            await request('/api/authorize/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_origin: window.location.origin }),
            });
        }
        finally {
            window.localStorage.removeItem(tokenKey);
            window.localStorage.removeItem(grantKey);
            emit('authorization_required');
        }
    }

    window.reupEngineClient = {
        engineUrl,
        request,
        json,
        check,
        connect,
        completeCallback,
        revoke,
        get status() { return state.status; },
        onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
})();
