import assert from "node:assert/strict";
import test from "node:test";
import { LocalEngineClient } from "../src/lib/local-engine-client.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("running engine connects automatically when the browser has no saved grant", async () => {
  const calls = [];
  let authorized = false;
  globalThis.window = {
    location: { origin: "https://www.reupai.cloud" },
    localStorage: storage(),
    setTimeout,
    clearTimeout,
    dispatchEvent: () => {},
    fetch: async (url, options = {}) => {
      calls.push([new URL(url).pathname, options.method || "GET"]);
      const path = new URL(url).pathname;
      if (path === "/api/health") return Response.json({ capabilities: { direct_authorization: true } });
      if (path === "/api/status") return authorized ? Response.json({ ok: true }) : new Response(null, { status: 401 });
      if (path === "/api/authorize/connect") {
        authorized = true;
        return Response.json({ session_token: "session", grant: "grant" });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };

  try {
    const client = new LocalEngineClient("http://127.0.0.1:17888");
    assert.equal(await client.check(), true);
    assert.equal(client.status, "connected");
    assert.equal(client.grant, "grant");
    assert.deepEqual(calls, [
      ["/api/health", "GET"],
      ["/api/status", "GET"],
      ["/api/authorize/connect", "POST"],
      ["/api/status", "GET"],
    ]);
  } finally {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});

test("an expired grant is replaced without asking the user to install again", async () => {
  const localStorage = storage();
  localStorage.setItem("reupai.local-engine.session", "old-session");
  localStorage.setItem("reupai.local-engine.grant", "old-grant");
  let authorized = false;
  globalThis.window = {
    location: { origin: "https://www.reupai.cloud" },
    localStorage,
    setTimeout,
    clearTimeout,
    dispatchEvent: () => {},
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/health") return Response.json({ capabilities: { direct_authorization: true } });
      if (path === "/api/status") return authorized ? Response.json({ ok: true }) : new Response(null, { status: 401 });
      if (path === "/api/authorize/session") return new Response(null, { status: 401 });
      if (path === "/api/authorize/connect") {
        authorized = true;
        return Response.json({ session_token: "new-session", grant: "new-grant" });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };

  try {
    const client = new LocalEngineClient("http://127.0.0.1:17888");
    assert.equal(await client.check(), true);
    assert.equal(client.status, "connected");
    assert.equal(client.grant, "new-grant");
  } finally {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});
