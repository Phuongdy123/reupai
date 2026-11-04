import { createHmac, timingSafeEqual } from "node:crypto";

function payosString(value) {
  if (value === null || value === undefined || value === "null" || value === "undefined") return "";
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => typeof item === "object" && item !== null ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function payosDataSignature(data, key) {
  if (!key || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Thiếu dữ liệu xác minh payOS.");
  const input = Object.keys(data).sort().map((field) => `${field}=${payosString(data[field])}`).join("&");
  return createHmac("sha256", key).update(input).digest("hex");
}

export function verifyPayosWebhook(payload, key) {
  const expected = payosDataSignature(payload?.data, key);
  const received = String(payload?.signature || "");
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
