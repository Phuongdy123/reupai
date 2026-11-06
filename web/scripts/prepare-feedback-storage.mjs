// Runs on the build server. Credentials never enter a browser bundle or log.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ensureFeedbackBucket, FEEDBACK_BUCKET } from '../src/lib/customer-feedback.js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !secret || !publicKey) {
  if (process.env.VERCEL_ENV === 'production') throw new Error('Production chưa cấu hình đủ Supabase cho hộp thư phản hồi.');
  console.log('Feedback storage: skipping provisioning outside configured production.');
} else {
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, options), anonymous = createClient(url, publicKey, options);
  await ensureFeedbackBucket(admin.storage);
  // Use a disposable non-ticket object to verify persistence and privacy.
  const path = `_provision-check-${randomUUID()}.json`;
  let uploaded = false;
  try {
    const result = await admin.storage.from(FEEDBACK_BUCKET).upload(path, JSON.stringify({ check: true }), { contentType: 'application/json', cacheControl: '0', upsert: false });
    if (result.error) throw new Error('Không ghi được kho phản hồi riêng tư.');
    uploaded = true;
    const own = await admin.storage.from(FEEDBACK_BUCKET).download(path);
    if (own.error || (await own.data.text()) !== '{"check":true}') throw new Error('Không đọc lại được dữ liệu kiểm tra phản hồi.');
    const guest = await anonymous.storage.from(FEEDBACK_BUCKET).download(path);
    if (!guest.error) throw new Error('Kho phản hồi cho phép truy cập ẩn danh; dừng triển khai.');
    console.log('Feedback storage: private bucket ready; write/read passed; anonymous read denied.');
  } finally {
    if (uploaded) {
      const removed = await admin.storage.from(FEEDBACK_BUCKET).remove([path]);
      if (removed.error) throw new Error('Chưa dọn được dữ liệu kiểm tra hộp thư phản hồi.');
    }
  }
}
