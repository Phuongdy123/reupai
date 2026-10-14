// Mount the mature product controls inside a native Next.js page. All requests
// use the application's one LocalEngineClient; the runtime owns only DOM state.
export async function mountProductRuntime(host, client, startRuntime) {
  const nativeDocument = window.document;
  const nativeWindow = window;
  const controller = new AbortController();
  const timers = new Set();
  const intervals = new Set();
  const subscriptions = [];
  const injectedStyles = [];
  const storage = new Map();
  let disposed = false;
  let runtime;

  const stateKeys = { "reup.sources.v13": "sources_v13", "reup.process.presets.v2": "process_presets_v2" };
  await Promise.all(Object.entries(stateKeys).map(async ([key, stateKey]) => {
    const data = await client.json(`/api/library/ui-state/${stateKey}`, { signal: controller.signal });
    if (data.value != null) storage.set(key, JSON.stringify(data.value));
  }));
  if (!host.isConnected) { controller.abort(); return () => {}; }

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    subscriptions.push(() => target.removeEventListener(type, handler, options));
  };
  const timed = (handler, delay, ...args) => {
    const id = nativeWindow.setTimeout(() => {
      timers.delete(id);
      if (!disposed) handler(...args);
    }, delay);
    timers.add(id);
    return id;
  };
  const clearTimed = (id) => { nativeWindow.clearTimeout(id); timers.delete(id); };
  const facade = Object.create(client);
  facade.request = (path, options = {}) => client.request(path, { ...options, signal: options.signal || controller.signal });
  facade.json = (path, options = {}) => client.json(path, { ...options, signal: options.signal || controller.signal });
  const scopedWindow = new Proxy(nativeWindow, {
    get(target, key) {
      if (key === "reupEngineClient") return facade;
      if (key === "setTimeout") return timed;
      if (key === "clearTimeout") return clearTimed;
      if (key === "addEventListener") return (type, handler, options) => listen(target, type, handler, options);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const scopedHead = new Proxy(nativeDocument.head, {
    get(target, key) {
      if (key === "appendChild") return (node) => { if (disposed) return node; injectedStyles.push(node); return target.appendChild(node); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shellElements = new WeakMap();
  const shellElement = (element) => {
    if (!element || host.contains(element)) return element;
    if (!shellElements.has(element)) shellElements.set(element, new Proxy(element, {
      get(target, key) {
        if (key === "addEventListener") return (type, handler, options) => listen(target, type, handler, options);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }));
    return shellElements.get(element);
  };
  const scopedDocument = new Proxy(nativeDocument, {
    get(target, key) {
      if (key === "body") return host;
      if (key === "head") return scopedHead;
      if (key === "getElementById") return (id) => disposed ? null : host.querySelector(`[id="${CSS.escape(id)}"]`) || shellElement(target.getElementById(id));
      if (key === "querySelector") return (selector) => disposed ? null : host.querySelector(selector) || target.querySelector(selector);
      if (key === "querySelectorAll") return (selector) => disposed ? [] : selector === "a[href]" || selector.includes(".nav") ? target.querySelectorAll(selector) : host.querySelectorAll(selector);
      if (key === "addEventListener") return (type, handler, options) => listen(target, type, handler, options);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key),
  };

  const mediaJobs = new WeakMap();
  const adapt = (node) => {
    if (!(node instanceof Element)) return;
    const elements = [node, ...node.querySelectorAll("*")];
    for (const element of elements) {
      for (const attr of [...element.attributes]) {
        if (!/^on(click|input|change|keydown|error|load)$/.test(attr.name)) continue;
        const code = attr.value;
        element.removeAttribute(attr.name);
        listen(element, attr.name.slice(2), (event) => runtime?.evaluate(code, event, element));
      }
      const path = element.getAttribute("data-engine-cover");
      if (path && mediaJobs.get(element) !== path) {
        mediaJobs.set(element, path);
        element.crossOrigin = "anonymous";
        client.mediaUrl(path).then((url) => { if (!disposed && element.isConnected && mediaJobs.get(element) === path) element.src = url; }).catch(() => { if (!disposed) element.style.display = "none"; });
      }
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") adapt(record.target);
      else for (const node of record.addedNodes) adapt(node);
    }
  });
  observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-engine-cover", "onclick", "oninput", "onchange", "onerror"] });
  listen(host, "click", (event) => {
    const link = event.target.closest("a[href]");
    const path = link?.getAttribute("href");
    if (!path?.startsWith("/api/")) return;
    event.preventDefault();
    client.downloadFile(path, link.download || undefined).catch((error) => host.dispatchEvent(new CustomEvent("product-runtime:error", { detail: error })));
  }, true);
  const cleanup = () => {
    disposed = true;
    controller.abort();
    observer.disconnect();
    subscriptions.forEach((unsubscribe) => unsubscribe());
    timers.forEach((id) => nativeWindow.clearTimeout(id));
    intervals.forEach((id) => nativeWindow.clearInterval(id));
    injectedStyles.forEach((style) => style.remove());
    host.querySelectorAll("video").forEach((video) => { video.pause(); video.removeAttribute("src"); video.load(); });
    host.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  };
  try {
    runtime = startRuntime({ document: scopedDocument, window: scopedWindow, localStorage, setTimeout: timed, clearTimeout: clearTimed, setInterval: (handler, delay) => { const id = nativeWindow.setInterval(() => { if (!disposed) handler(); }, delay); intervals.add(id); return id; }, clearInterval: (id) => { nativeWindow.clearInterval(id); intervals.delete(id); }, fetch: facade.request, history: nativeWindow.history });
    adapt(host);
    Promise.resolve(runtime.ready).then(() => {
      if (!disposed) host.dispatchEvent(new CustomEvent("product-runtime:ready"));
    }).catch((error) => { if (!disposed) host.dispatchEvent(new CustomEvent("product-runtime:error", { detail: error })); });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
