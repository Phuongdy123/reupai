"use client";

import { useState } from "react";
import { Icon } from "./icon";

const PAGE_SIZE = 30;
export function OutputTranscriptEditor({ cues, onChange, onSeek, supported }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const filtered = cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => !query || cue.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return <section className="output-transcript-panel" aria-label="Sửa bản dịch tiếng Việt">
    <header>
      <div><strong>Thoại tiếng Việt</strong><p>Sửa lời thoại và mốc thời gian để xuất lại bản mới.</p></div>
      <span>{cues.length} câu</span>
    </header>
    {!supported ? <p className="output-transcript-unsupported">Cần <a href="/api/engine/download" target="_blank" rel="noopener">cập nhật Local Engine 0.2.52</a> để chỉnh thoại trong thành phẩm.</p> : <>
      <div className="output-transcript-search">
        <Icon name="search" size={14} />
        <input aria-label="Tìm câu đã dịch" placeholder="Tìm câu trong bản dịch…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      </div>
      <div className="output-transcript-cues">{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(({ cue, index }) => <div className="output-transcript-cue" key={index}>
        <div className="output-transcript-time">
          <button type="button" className="btn secondary" onClick={() => onSeek(cue)} aria-label={`Nghe thử câu ${index + 1}`} title="Nghe thử đoạn này"><Icon name="play" size={11} />{index + 1}</button>
          <div className="output-transcript-range">
            <input aria-label={`Bắt đầu câu ${index + 1}`} type="number" min="0" step="0.01" value={cue.start} onChange={event => onChange(index, "start", event.target.value)} />
            <span>→</span>
            <input aria-label={`Kết thúc câu ${index + 1}`} type="number" min="0" step="0.01" value={cue.end} onChange={event => onChange(index, "end", event.target.value)} />
            <small>s</small>
          </div>
        </div>
        <textarea aria-label={`Bản dịch câu ${index + 1}`} rows={2} maxLength={2000} value={cue.text} onChange={event => onChange(index, "text", event.target.value)} />
      </div>)}{!filtered.length && <p className="muted">{cues.length ? "Không tìm thấy câu phù hợp." : "Thành phẩm này chưa có file phụ đề để chỉnh."}</p>}</div>
      {pages > 1 && <nav className="output-transcript-pages" aria-label="Trang lời thoại"><button type="button" className="btn secondary" disabled={!current} onClick={() => setPage(current - 1)}>Trước</button><span>Trang {current + 1} / {pages}</span><button type="button" className="btn secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Tiếp</button></nav>}
    </>}
  </section>;
}
