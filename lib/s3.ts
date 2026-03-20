import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

if (!process.env.R2_ACCESS_KEY_ID) throw new Error('R2_ACCESS_KEY_ID is not set');
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error('R2_SECRET_ACCESS_KEY is not set');
if (!process.env.R2_ENDPOINT_URL) throw new Error('R2_ENDPOINT_URL is not set');
if (!process.env.R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME is not set');

export const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME;

// Generate a presigned URL for a direct client → R2 PUT upload
export async function getUploadPresignedUrl(
  storageKey: string,
  contentType: string,
  expiresIn = 300 // 5 minutes
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// Generate a presigned URL for a direct client ← R2 GET download
export async function getDownloadPresignedUrl(
  storageKey: string,
  expiresIn = 3600 // 1 hour
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

// Construct the public URL for a stored object
export function getPublicUrl(storageKey: string): string {
  return `${process.env.R2_ENDPOINT_URL}/${BUCKET}/${storageKey}`;
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}
