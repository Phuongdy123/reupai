import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback, ensureFeedbackBucket, submitCustomerFeedback, listCustomerFeedback, updateCustomerFeedback, FEEDBACK_BUCKET } from '../src/lib/customer-feedback.js';

const user = { id:'12345678-1234-1234-1234-123456789abc', email:'customer@example.test' };
const input = { category:'bug', subject:'Không tải được video', message:'Bilibili trả lỗi HTTP 412 khi tải.', details:'HTTP 412', link:'https://www.bilibili.com/video/fixture', requestId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
function fixture() {
  const objects = new Map(); let publicBucket = false;
  const storage = {
    getBucket: async () => ({ data:{ public:publicBucket } }),
    createBucket: async () => ({ data:{} }),
    from(bucket) {
      assert.equal(bucket, FEEDBACK_BUCKET);
      return {
        async upload(path, body, options) {
          assert.equal(options.upsert, false);
          if(objects.has(path)) return { error:{statusCode:409,message:'already exists'} };
          objects.set(path, body); return {data:{path}};
        },
        async download(path) { return objects.has(path) ? {data:new Blob([objects.get(path)])} : {error:{statusCode:404}}; },
        async list(_, options) { assert.deepEqual(options.sortBy,{column:'name',order:'desc'}); return {data:[...objects.keys()].sort().reverse().slice(options.offset, options.offset+options.limit).map(name=>({name}))}; },
        async update(path, body) { if(!objects.has(path)) return {error:{statusCode:404}}; objects.set(path,body); return {data:{path}}; },
      };
    },
  };
  return { storage, objects, makePublic:()=>publicBucket=true };
}

test('validates feedback limits and rejects script links or forged category', () => {
  assert.equal(validateFeedback(input).message,input.message);
  for(const bad of [{message:'x'},{category:'admin'},{link:'javascript:alert(1)'},{link:'https://name:secret@example.com'},{details:'x'.repeat(6001)},{requestId:'../other'}]) {
    assert.throws(()=>validateFeedback({...input,...bad}), error=>error.status===400);
  }
});
test('creates a private bucket when absent, and refuses a public bucket', async () => {
  let calls=0;
  const storage={getBucket:async()=>({error:{statusCode:404}}),createBucket:async(name,options)=>{calls++;assert.equal(name,FEEDBACK_BUCKET);assert.equal(options.public,false);assert.equal(options.fileSizeLimit,65536);return {data:{}};}};
  await ensureFeedbackBucket(storage); assert.equal(calls,1);
  const f=fixture();f.makePublic();
  await assert.rejects(()=>ensureFeedbackBucket(f.storage));
});
test('receipt requires a durable upload, uses authenticated identity and keeps content', async () => {
  const f=fixture();
  const receipt=await submitCustomerFeedback(f.storage,user,{display_name:'Khách'}, {...input,userId:'forged',email:'forged@example.test'}, 1794000000000);
  const stored=JSON.parse(f.objects.get(`${receipt.id}.json`));
  assert.equal(stored.userId,user.id);assert.equal(stored.email,user.email);assert.equal(stored.status,'new');assert.equal(stored.message,input.message);
  const failure=fixture();failure.storage.from=()=>({upload:async()=>({error:{statusCode:500,message:'secret server detail'}})});
  await assert.rejects(()=>submitCustomerFeedback(failure.storage,user,{},input),error=>error.status===503&&!error.message.includes('secret server detail'));
});
test('atomic minute slot prevents concurrent duplicates and limits new submissions', async () => {
  const f=fixture();const now=1794000000000;
  const receipts=await Promise.all([submitCustomerFeedback(f.storage,user,{},input,now),submitCustomerFeedback(f.storage,user,{},input,now)]);
  assert.equal(receipts[0].id,receipts[1].id);assert.equal(f.objects.size,1);
  await assert.rejects(()=>submitCustomerFeedback(f.storage,user,{}, {...input,requestId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},now),error=>error.status===429);
  await submitCustomerFeedback(f.storage,user,{},input,now+60000);assert.equal(f.objects.size,2);
});
test('admin pagination has no missing extra record and status changes preserve original content', async () => {
  const f=fixture();const now=1794000000000;
  for(let i=0;i<22;i++) await submitCustomerFeedback(f.storage,user,{},input,now+i*60000);
  const page=await listCustomerFeedback(f.storage,0), next=await listCustomerFeedback(f.storage,20);
  assert.equal(page.items.length,20);assert.equal(page.hasMore,true);assert.equal(next.items.length,2);assert.equal(next.hasMore,false);
  assert.equal(new Set([...page.items,...next.items].map(item=>item.id)).size,22);
  const updated=await updateCustomerFeedback(f.storage,page.items[0].id,'resolved');
  assert.equal(updated.status,'resolved');assert.equal(updated.message,input.message);assert.equal(updated.email,user.email);
  await assert.rejects(()=>updateCustomerFeedback(f.storage,'../../other','resolved'),error=>error.status===400);
  await assert.rejects(()=>updateCustomerFeedback(f.storage,page.items[0].id,'invalid'),error=>error.status===400);
});
