/**
 * The four YouTube Data API v3 calls we need, over plain fetch:
 * channels.list (which channel is this login?), playlists.list/insert,
 * videos.insert (resumable upload), playlistItems.insert.
 */
import type { FetchFn } from './google-auth.js';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

export interface VideoMetadata {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string; defaultAudioLanguage: string };
  status: { privacyStatus: 'public' | 'unlisted' | 'private'; selfDeclaredMadeForKids: boolean; embeddable: boolean };
}

export interface UploadResult {
  id: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  uploadStatus: string;
}

export class YouTubeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

async function check(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { message?: string; errors?: { reason?: string }[] } | undefined;
    const reason = err?.errors?.[0]?.reason ? ` (${err.errors[0].reason})` : '';
    throw new YouTubeError(res.status, `${what} failed: ${res.status} ${err?.message ?? ''}${reason}`.trim());
  }
  return body;
}

export class YouTube {
  constructor(
    private fetchFn: FetchFn,
    private token: () => Promise<string>,
  ) {}

  private async auth(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.token()}`, ...extra };
  }

  async channel(): Promise<{ id: string; title: string }> {
    const b = await check(await this.fetchFn(`${API}/channels?part=snippet&mine=true`, { headers: await this.auth() }), 'channels.list');
    const item = (b.items as { id: string; snippet: { title: string } }[] | undefined)?.[0];
    if (!item) throw new YouTubeError(404, 'this Google login has no YouTube channel');
    return { id: item.id, title: item.snippet.title };
  }

  async findOrCreatePlaylist(title: string, description: string): Promise<string> {
    const list = await check(await this.fetchFn(`${API}/playlists?part=snippet&mine=true&maxResults=50`, { headers: await this.auth() }), 'playlists.list');
    const found = (list.items as { id: string; snippet: { title: string } }[] | undefined)?.find((p) => p.snippet.title === title);
    if (found) return found.id;
    const created = await check(
      await this.fetchFn(`${API}/playlists?part=snippet,status`, {
        method: 'POST',
        headers: await this.auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snippet: { title, description, defaultLanguage: 'en' }, status: { privacyStatus: 'public' } }),
      }),
      'playlists.insert',
    );
    return String(created.id);
  }

  async addToPlaylist(playlistId: string, videoId: string): Promise<void> {
    await check(
      await this.fetchFn(`${API}/playlistItems?part=snippet`, {
        method: 'POST',
        headers: await this.auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }),
      }),
      'playlistItems.insert',
    );
  }

  /** Current privacy of our uploads (YouTube may lock unaudited uploads to private after processing). */
  async visibility(ids: string[]): Promise<Map<string, UploadResult['privacyStatus']>> {
    if (ids.length === 0) return new Map();
    const b = await check(await this.fetchFn(`${API}/videos?part=status&id=${ids.slice(0, 50).join(',')}`, { headers: await this.auth() }), 'videos.list');
    const items = (b.items as { id: string; status: { privacyStatus: UploadResult['privacyStatus'] } }[] | undefined) ?? [];
    return new Map(items.map((i) => [i.id, i.status.privacyStatus]));
  }

  /** Resumable upload in one PUT (our files are a few MB). */
  async upload(bytes: Uint8Array, meta: VideoMetadata): Promise<UploadResult> {
    const init = await this.fetchFn(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: await this.auth({
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(bytes.byteLength),
        'X-Upload-Content-Type': 'video/mp4',
      }),
      body: JSON.stringify(meta),
    });
    if (!init.ok) await check(init, 'videos.insert (start)');
    const location = init.headers.get('location');
    if (!location) throw new YouTubeError(init.status, 'videos.insert (start) returned no upload URL');

    const put = await this.fetchFn(location, {
      method: 'PUT',
      headers: await this.auth({ 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) }),
      body: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
    });
    const v = await check(put, 'videos.insert (upload)');
    const status = v.status as { privacyStatus?: UploadResult['privacyStatus']; uploadStatus?: string } | undefined;
    return { id: String(v.id), privacyStatus: status?.privacyStatus ?? 'private', uploadStatus: status?.uploadStatus ?? 'unknown' };
  }
}
