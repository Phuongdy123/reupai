"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { localEngineClient } from "../../../src/lib/local-engine-client";

function CallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState("Đang hoàn tất cấp quyền…");

  useEffect(() => {
    const complete = async () => {
      const connected = await localEngineClient.completeAuthorization(params.get("code"), params.get("state"));
      if (connected) router.replace("/");
      else setMessage(localEngineClient.connection.error?.message || "Không thể cấp quyền Local Engine.");
    };
    complete();
  }, [params, router]);

  return <section className="state-panel"><span className="spinner" /><h2>ReupAI Local</h2><p>{message}</p></section>;
}

export default function CallbackPage() {
  return <Suspense fallback={<section className="state-panel"><span className="spinner" /><h2>ReupAI Local</h2><p>Đang mở callback cấp quyền…</p></section>}><CallbackContent /></Suspense>;
}
