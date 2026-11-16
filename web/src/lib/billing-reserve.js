function randomUuidV4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function reserveBillingToken({ videoId, mode }) {
  const normalizedMode = mode === "subtitle" ? "subtitle" : "voiceover";
  const response = await window.fetch("/api/billing/jobs/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      jobKey: randomUuidV4(),
      videoId: String(videoId || ""),
      mode: normalizedMode,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (response.ok && result?.token) {
    return result.token;
  }

  if (response.status === 503 && !result?.code) {
    try {
      const cfgRes = await window.fetch("/api/billing/config", { cache: "no-store", credentials: "same-origin" });
      const cfg = await cfgRes.json().catch(() => ({}));
      if (cfgRes.ok && cfg?.enabled === false) {
        return null;
      }
    } catch {
      // ignore fallback config check errors
    }
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error(result?.error || "Phiên đăng nhập hoặc quyền tài khoản đã hết hạn. Hãy đăng nhập lại rồi thử lại.");
    err.status = response.status;
    throw err;
  }

  if (response.status === 402 || result?.reason === "trial_exhausted") {
    const err = new Error(result?.error || "Bạn đã hết lượt xử lý. Mở Gói dịch vụ để nâng cấp Pro.");
    err.status = 402;
    throw err;
  }

  const err = new Error(result?.error || "Máy chủ chưa cấp được lượt xử lý. Vui lòng thử lại sau.");
  err.status = response.status;
  throw err;
}

export async function releaseBillingToken(token) {
  if (!token) return;
  try {
    await window.fetch("/api/billing/jobs/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token, status: "failed" }),
    });
  } catch {
    // non-fatal cleanup
  }
}
