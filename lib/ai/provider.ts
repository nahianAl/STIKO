import type { CompleteOptions, CompleteResult } from './types';

/**
 * The single seam to third-party inference.
 *
 * Shaped after lib/email.ts rather than lib/cloudconvert.ts: one function,
 * plain fetch, no new dependency, and an honest failure flag instead of a
 * thrown error. Callers can then degrade — the fact strip renders even when
 * there is no key and no network.
 *
 * The endpoint is OpenAI-compatible, so switching provider is a base-URL and
 * model-name change, not a code change.
 */

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 20_000;

export function isConfigured(): boolean {
  return Boolean(process.env.ATLAS_API_KEY);
}

export function activeModel(): string {
  return process.env.ATLAS_MODEL || DEFAULT_MODEL;
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const apiKey = process.env.ATLAS_API_KEY;
  if (!apiKey) {
    console.info('[ai] skipped — ATLAS_API_KEY is not configured');
    return { ok: false, reason: 'Summarisation is not configured' };
  }

  const baseUrl = process.env.ATLAS_BASE_URL || DEFAULT_BASE_URL;
  const model = activeModel();

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1200,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[ai] provider rejected the request: ${res.status} ${detail}`);
      return { ok: false, reason: 'The summarisation provider rejected the request' };
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      console.error('[ai] provider returned an unreadable response body');
      return { ok: false, reason: 'The summarisation provider returned an unreadable response body' };
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      console.error('[ai] provider returned no message content');
      return { ok: false, reason: 'The summarisation provider returned nothing usable' };
    }

    try {
      return { ok: true, data: JSON.parse(content), model };
    } catch {
      // Not a crash: a model that ignores json_object is a provider failure
      // like any other, and the caller keeps whatever brief it already had.
      console.error('[ai] provider returned non-JSON content');
      return { ok: false, reason: 'The summarisation provider returned malformed output' };
    }
  } catch (err) {
    console.error('[ai] transport error', err);
    return { ok: false, reason: 'Could not reach the summarisation provider' };
  }
}
