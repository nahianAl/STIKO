import crypto from 'crypto';

const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY!;
const CLOUDCONVERT_WEBHOOK_SECRET = process.env.CLOUDCONVERT_WEBHOOK_SECRET!;
const BASE_URL = 'https://api.cloudconvert.com/v2';

export interface CloudConvertTask {
  id: string;
  name: string;
  operation: string;
  status: string;
  result?: {
    files?: Array<{ filename: string; url: string }>;
  };
}

export interface CloudConvertJob {
  id: string;
  status: string;
  tasks: CloudConvertTask[];
}

export async function createStepToGlbJob(inputFileUrl: string): Promise<CloudConvertJob> {
  const response = await fetch(`${BASE_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tasks: {
        'import-step': {
          operation: 'import/url',
          url: inputFileUrl,
        },
        'convert-to-glb': {
          operation: 'convert',
          input: 'import-step',
          output_format: 'glb',
        },
        'export-result': {
          operation: 'export/url',
          input: 'convert-to-glb',
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`CloudConvert job creation failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.data;
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', CLOUDCONVERT_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
