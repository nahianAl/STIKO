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

// Range GET, not HEAD: SigV4 signs the HTTP method, so HEAD on a GET-signed URL is a
// signature mismatch (403). Range: bytes=0-0 reads one byte over GET, keeping the
// signature valid while avoiding the full 90 MB object.
const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
const got = res.headers.get('cache-control');
console.log('key         :', target.Key);
console.log('status      :', res.status, '(206 expected)');
console.log('cache-control:', got ?? '(absent)');
// Gate on the status as well as the header. A 200 here would mean the Range never
// engaged, so the run just pulled a whole object and proved something other than what
// it claims to test — and a verdict that reads PASS on it would be lying.
console.log(
  res.status === 206 && got === 'private, max-age=3600, immutable'
    ? '\nPASS — R2 honours the override. Task 3 is safe to implement.'
    : '\nFAIL — R2 did not echo the override, or the Range did not engage. STOP and revisit the spec.'
);
