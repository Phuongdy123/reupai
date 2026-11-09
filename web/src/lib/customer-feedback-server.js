import { createAdminSupabaseClient, createServerSupabaseClient } from './supabase/server';
import { FeedbackError } from './customer-feedback';

export async function requireFeedbackAccount(adminOnly = false) {
  const { data: { user }, error: authError } = await createServerSupabaseClient().auth.getUser();
  if (authError || !user) throw new FeedbackError('Hãy đăng nhập để gửi phản hồi.', 401);
  const admin = createAdminSupabaseClient();
  const { data: profile, error } = await admin.from('profiles').select('display_name,role,status').eq('id', user.id).maybeSingle();
  if (error) throw new FeedbackError('Chưa xác nhận được tài khoản. Hãy thử lại.');
  if (profile?.status !== 'approved' || adminOnly && profile.role !== 'admin') throw new FeedbackError('Bạn không có quyền thực hiện thao tác này.', 403);
  return { user, profile, storage: admin.storage };
}

export async function feedbackRequestBody(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new FeedbackError('Nguồn yêu cầu không hợp lệ.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new FeedbackError('Định dạng gửi không hợp lệ.', 415);
  if (Number(request.headers.get('content-length')) > 65536) throw new FeedbackError('Phản hồi quá dài.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError('Chưa có nội dung phản hồi.', 400);
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) { await reader.cancel(); throw new FeedbackError('Phản hồi quá dài.', 413); }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new FeedbackError('Nội dung gửi không hợp lệ.', 400); }
}

export function feedbackErrorResponse(error) {
  const status = error instanceof FeedbackError ? error.status : 503;
  return Response.json({ error: error instanceof FeedbackError ? error.message : 'Chưa kết nối được hộp thư phản hồi. Hãy thử lại.' },
    { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}
