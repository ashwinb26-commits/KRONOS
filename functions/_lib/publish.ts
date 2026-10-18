/**
 * Server side of publishing. The rules live in shared/publish.ts so the
 * GitHub Pages build can apply exactly the same ones in the browser. This file
 * adds the part only a server needs: reading a request body safely.
 */

import { MAX_PAYLOAD_BYTES } from '../../shared/validation';

export * from '../../shared/publish';

/** Read a JSON body with a hard size cap applied before parsing. */
export async function readJsonBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; code: string; message: string }
> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'payload_too_large',
      message: 'That update is larger than the server accepts. Remove unused historical years or sources.',
    };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'payload_too_large',
      message: 'That update is larger than the server accepts. Remove unused historical years or sources.',
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: 'bad_json', message: 'The update could not be read. Reload the studio and try again.' };
  }
}
