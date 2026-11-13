"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { safeAuthPath } from "../lib/auth-navigation.mjs";
import { Icon } from "./icon";
import { GUEST_WORKSPACE_ROUTES } from "../lib/workspace-routes.mjs";

const memberAccess = { isGuest: false, promptOpen: false, requestSignIn: () => {}, ensureAuthenticated: () => true };
const GuestAccessContext = createContext(memberAccess);
const publicPaths = new Set(["/", ...GUEST_WORKSPACE_ROUTES, "/sign-in", "/sign-up", "/plans", "/terms", "/privacy", "/local-engine"]);

export function GuestAccessProvider({ children }) {
  const [prompt, setPrompt] = useState(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const requestSignIn = useCallback(({ next = "/app", reason = "Đăng nhập để lưu dự án, dùng AI và bắt đầu xử lý video." } = {}) => {
    setPrompt({ next: safeAuthPath(next), reason });
  }, []);
  const ensureAuthenticated = useCallback((options) => { requestSignIn(options); return false; }, [requestSignIn]);
  const value = useMemo(() => ({ isGuest: true, promptOpen: Boolean(prompt), requestSignIn, ensureAuthenticated }), [prompt, requestSignIn, ensureAuthenticated]);

  useEffect(() => {
    if (!prompt) return;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); setPrompt(null); }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll('a[href], button:not(:disabled)') || [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused?.isConnected && !previouslyFocused.closest(".sidebar, .quick-nav-dialog") && previouslyFocused.getClientRects().length) previouslyFocused.focus();
      else document.querySelector(".workspace-guest-signin")?.focus();
    };
  }, [prompt]);

  function guardNavigation(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.getAttribute("href"), window.location.origin);
    if (url.origin !== window.location.origin || publicPaths.has(url.pathname) || url.pathname.startsWith("/giai-phap")) return;
    event.preventDefault();
    event.stopPropagation();
    requestSignIn({ next: `${url.pathname}${url.search}${url.hash}` });
  }

  const suffix = prompt ? `?next=${encodeURIComponent(prompt.next)}` : "";
  return <GuestAccessContext.Provider value={value}>
    <div className="guest-workspace" onClickCapture={guardNavigation}>{children}</div>
    {prompt && <div className="guest-auth-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setPrompt(null); }}>
      <section className="guest-auth-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="guest-auth-title" aria-describedby="guest-auth-description">
        <button className="guest-auth-close" type="button" ref={closeRef} onClick={() => setPrompt(null)} aria-label="Đóng yêu cầu đăng nhập">×</button>
        <span className="guest-auth-mark" aria-hidden="true"><Icon name="lock" size={23} /></span>
        <p className="guest-auth-eyebrow">KHÔNG GIAN CỦA RIÊNG BẠN</p>
        <h2 id="guest-auth-title">Đăng nhập để tiếp tục.</h2>
        <p id="guest-auth-description">{prompt.reason}</p>
        <Link className="guest-auth-primary" href={`/sign-in${suffix}`}>Đăng nhập <span aria-hidden="true">→</span></Link>
        <Link className="guest-auth-secondary" href={`/sign-up${suffix}`}>Tạo tài khoản mới</Link>
        <button className="guest-auth-explore" type="button" onClick={() => setPrompt(null)}>Tiếp tục khám phá</button>
      </section>
    </div>}
  </GuestAccessContext.Provider>;
}

export function useGuestAccess() { return useContext(GuestAccessContext); }
