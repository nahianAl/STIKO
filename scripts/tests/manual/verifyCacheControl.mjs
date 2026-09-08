// scripts/tests/manual/verifyCacheControl.mjs
//
// Manual, read-only. Confirms R2 honours the response-cache-control override on a
// presigned GET. Run once before implementing the viewer URL change.
//
//   node scripts/tests/manual/verifyCacheControl.mjs
import { readFileSync } from 'node:fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const listed = await s3.send(
  new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, Prefix: 'uploads/', MaxKeys: 200 })
);
const target = (listed.Contents || []).find((o) => /\.glb$/i.test(o.Key));
if (!target) throw new Error('no .glb object found to test against');

const url = await getSignedUrl(
  s3,
  new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: target.Key,
    ResponseCacheControl: 'private, max-age=3600, immutable',
  }),
  { expiresIn: 300 }
);

// HEAD, not GET: the header is what is under test, and the object may be 90 MB.
const res = await fetch(url, { method: 'HEAD' });
const got = res.headers.get('cache-control');
console.log('key         :', target.Key);
console.log('status      :', res.status);
console.log('cache-control:', got ?? '(absent)');
console.log(
  got === 'private, max-age=3600, immutable'
    ? '\nPASS — R2 honours the override. Task 3 is safe to implement.'
    : '\nFAIL — R2 did not echo the override. STOP and revisit the spec.'
);
