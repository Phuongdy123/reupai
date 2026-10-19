const DEFAULT_ENGINE_URL = "http://127.0.0.1:17888";
const SESSION_KEY = "reupai.local-engine.session";
const GRANT_KEY = "reupai.local-engine.grant";
const STATE_KEY = "reupai.local-engine.state";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function isBrowser() {
  return typeof window !== "undefined";
}

function mapPath(path) {
  const value = String(path || "");
  if (value === "/api/jobs/active") return "/api/jobs";
  const process = value.match(/^\/api\/process\/([^/?]+)(?:\?(.*))?$/);
  if (process) return `/api/jobs/${process[1]}${process[2] ? `?${process[2]}` : ""}`;
  const stop = value.match(/^\/api\/process\/([^/]+)\/stop(?:\?(.*))?$/);
  if (stop) return `/api/jobs/${stop[1]}/stop${stop[2] ? `?${stop[2]}` : ""}`;
  return value;
}

async function fetchWithTimeout(url, options = {}, fallbackTimeout = DEFAULT_REQUEST_TIMEOUT_MS) {
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

async function responseError(response, fallback = "Local Engine không thể hoàn tất yêu cầu.") {
  let detail = "";
  try {
    const data = await response.json();
    detail = typeof data?.detail === "string" ? data.detail : "";
  } catch (_) { /* A proxy or an older Engine may return an empty response. */ }
  const error = new Error(detail || `${fallback} (HTTP ${response.status}).`);
  error.status = response.status;
  return error;
}

export class LocalEngineClient {
  constructor(baseUrl = process.env.NEXT_PUBLIC_LOCAL_ENGINE_URL || DEFAULT_ENGINE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.listeners = new Set();
    this.connection = { status: "disconnected", error: null };
    this.mediaTickets = new Map();
    this.mediaTicketRequests = new Map();
    this.refreshingSession = null;
    this.checkingConnection = null;
  }

  get engineUrl() { return this.baseUrl; }
  get status() { return this.connection.status; }
  connect() { return this.authorizeDirectly(); }

  get sessionToken() { return isBrowser() ? window.localStorage.getItem(SESSION_KEY) : null; }
  get grant() { return isBrowser() ? window.localStorage.getItem(GRANT_KEY) : null; }
  get hasPersistentGrant() { return Boolean(this.grant); }

  setSessionToken(value) {
    if (!isBrowser()) return;
    if (value) window.localStorage.setItem(SESSION_KEY, value);
    else window.localStorage.removeItem(SESSION_KEY);
  }

  setGrant(value) {
    if (!isBrowser()) return;
    if (value) window.localStorage.setItem(GRANT_KEY, value);
    else window.localStorage.removeItem(GRANT_KEY);
  }

  emit(status, error = null) {
    this.connection = { status, error };
    this.listeners.forEach((listener) => listener(this.connection));
    if (isBrowser()) window.dispatchEvent(new CustomEvent("reupai:connection", { detail: this.connection }));
  }

  onChange(listener) {
    this.listeners.add(listener);
    listener(this.connection);
    return () => this.listeners.delete(listener);
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.sessionToken) headers.set("Authorization", `Bearer ${this.sessionToken}`);
    let response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}${mapPath(path)}`, { cache: "no-store", ...options, headers });
      if (response.status === 401 && this.grant && !String(path).startsWith("/api/authorize/")) {
        if (await this.refreshSession()) {
          headers.set("Authorization", `Bearer ${this.sessionToken}`);
          response = await fetchWithTimeout(`${this.baseUrl}${mapPath(path)}`, { cache: "no-store", ...options, headers });
        }
      }
    } catch (error) {
      if (error.name !== "AbortError" && /fetch|network/i.test(error.message || "")) this.emit("disconnected", error);
      throw error;
    }
    if (response.status === 401) this.emit("authorization_required");
    return response;
  }

  async json(path, options = {}) {
    const response = await this.request(path, options);
    let data = {};
    try { data = await response.json(); } catch (_) { /* no body */ }
    if (!response.ok) {
      const error = new Error(typeof data.detail === "string" ? data.detail : `Local Engine HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async refreshSession() {
    if (this.refreshingSession) return this.refreshingSession;
    this.refreshingSession = this.refreshStoredGrant();
    try { return await this.refreshingSession; }
    finally { this.refreshingSession = null; }
  }

  async refreshStoredGrant() {
    if (!this.grant) return false;
    const response = await fetchWithTimeout(`${this.baseUrl}/api/authorize/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_origin: window.location.origin, grant: this.grant }),
      timeoutMs: 8000,
    });
    if (response.ok) {
      const data = await response.json();
      this.setSessionToken(data.session_token);
      this.mediaTickets.clear();
      this.mediaTicketRequests.clear();
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      this.setSessionToken(null);
      this.setGrant(null);
    }
    return false;
  }

  async check() {
    if (this.checkingConnection) return this.checkingConnection;
    this.checkingConnection = this.checkConnection();
    try { return await this.checkingConnection; }
    finally { this.checkingConnection = null; }
  }

  async checkConnection() {
    if (this.status !== "connected") this.emit("checking");
    try {
      const healthResponse = await fetchWithTimeout(`${this.baseUrl}/api/health`, { cache: "no-store", timeoutMs: 8000 });
      if (!healthResponse.ok) throw await responseError(healthResponse, "Không thể kiểm tra Local Engine");
      const health = await healthResponse.json().catch(() => ({}));
      if (!health?.capabilities?.direct_authorization) {
        throw Object.assign(new Error("Local Engine đang là bản cũ. Hãy cập nhật để kết nối một chạm."), { code: "engine_update_required" });
      }
      let status = await this.request("/api/status", { cache: "no-store" });
      if (status.status === 401 && await this.refreshSession()) {
        status = await this.request("/api/status", { cache: "no-store" });
      }
      if (status.status === 401) {
        this.emit("authorization_required");
        return false;
      }
      if (!status.ok) throw new Error(`Status HTTP ${status.status}`);
      this.emit("connected");
      return true;
    } catch (error) {
      if (["AbortError", "TimeoutError", "TypeError"].includes(error.name) || /fetch|network/i.test(error.message || "")) this.emit("disconnected", error);
      else if (error.code === "engine_update_required") this.emit("update_required", error);
      else this.emit("error", error);
      return false;
    }
  }

  async authorizeDirectly() {
    if (!isBrowser()) return false;
    this.emit("authorizing");
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/authorize/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_origin: window.location.origin }),
        timeoutMs: 8000,
      });
      if (response.status === 404) {
        throw Object.assign(new Error("Local Engine đang là bản cũ. Hãy cập nhật để kết nối một chạm."), { code: "engine_update_required" });
      }
      if (!response.ok) throw await responseError(response, "Không thể cấp quyền Local Engine");
      const data = await response.json();
      this.setSessionToken(data.session_token);
      this.setGrant(data.grant);
      this.mediaTickets.clear();
      this.mediaTicketRequests.clear();
      return await this.check();
    } catch (error) {
      if (["AbortError", "TimeoutError", "TypeError"].includes(error.name) || /fetch|network/i.test(error.message || "")) this.emit("disconnected", error);
      else if (error.code === "engine_update_required") this.emit("update_required", error);
      else this.emit(error.status === 403 ? "permission_denied" : "error", error);
      return false;
    }
  }

  beginAuthorization() {
    if (!isBrowser()) return;
    const state = window.crypto.randomUUID();
    window.sessionStorage.setItem(STATE_KEY, state);
    const params = new URLSearchParams({
      client_origin: window.location.origin,
      redirect_uri: `${window.location.origin}/local-engine/callback`,
      state,
    });
    this.emit("authorizing");
    window.location.assign(`${this.baseUrl}/authorize?${params.toString()}`);
  }

  async mediaUrl(path) {
    const resource = String(path || "").startsWith("/") ? path : `/api/files/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
    const now = Date.now();
    for (const [key, ticket] of this.mediaTickets) if (ticket.expires <= now) this.mediaTickets.delete(key);
    const cached = this.mediaTickets.get(resource);
    if (cached && cached.expires > now) return cached.url;
    if (this.mediaTicketRequests.has(resource)) return this.mediaTicketRequests.get(resource);
    const request = this.createMediaTicket(resource).then((data) => {
      const url = `${this.baseUrl}${data.url}`;
      this.mediaTickets.set(resource, { url, expires: Date.now() + Math.max(0, data.expires_in - 30) * 1000 });
      while (this.mediaTickets.size > 256) this.mediaTickets.delete(this.mediaTickets.keys().next().value);
      return url;
    });
    this.mediaTicketRequests.set(resource, request);
    try { return await request; }
    finally { this.mediaTicketRequests.delete(resource); }
  }

  async createMediaTicket(resource, options = {}) {
    return this.json("/api/media/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: resource, ...options }),
    });
  }

  async downloadFile(path, filename = "video.mp4") {
    const resource = String(path || "").startsWith("/") ? path : `/api/files/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
    const ticket = await this.createMediaTicket(resource, { download: "1", filename });
    if (ticket.download) {
      const anchor = document.createElement("a");
      anchor.href = `${this.baseUrl}${ticket.url}`; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      return;
    }
    // Engines released before streaming download tickets keep their existing
    // endpoint response. Preserve that path until every local installation is
    // upgraded instead of breaking downloads from an older executable.
    const response = await this.request(resource, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Không thể tải file (HTTP ${response.status}).`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async completeAuthorization(code, returnedState) {
    const expected = window.sessionStorage.getItem(STATE_KEY);
    if (!code || !returnedState || returnedState !== expected) {
      this.emit("permission_denied", new Error("Authorization state không hợp lệ."));
      return false;
    }
    this.emit("authorizing");
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/authorize/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, client_origin: window.location.origin }),
        timeoutMs: 8000,
      });
      if (!response.ok) throw await responseError(response, "Không thể hoàn tất kết nối Local Engine");
      const data = await response.json();
      this.setSessionToken(data.session_token);
      this.setGrant(data.grant);
      window.sessionStorage.removeItem(STATE_KEY);
      return this.check();
    } catch (error) {
      this.emit(error.status === 403 ? "permission_denied" : "error", error);
      return false;
    }
  }

  async revoke() {
    try {
      await this.request("/api/authorize/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_origin: window.location.origin }),
      });
    } finally {
      this.setSessionToken(null);
      this.setGrant(null);
      this.mediaTickets.clear();
      this.mediaTicketRequests.clear();
      this.emit("authorization_required");
    }
  }
}

export const localEngineClient = new LocalEngineClient();
