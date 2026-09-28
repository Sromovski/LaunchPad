/** A tiny in-memory YouTube + Google token endpoint for tests. Records every call. */
export interface FakeOptions {
  channelTitle?: string;
  channelId?: string;
  privacyAfterUpload?: 'public' | 'private';
  failPlaylistAdd?: boolean;
  existingPlaylist?: boolean;
  /** What videos.list reports later (e.g. locked to private after processing). */
  laterPrivacy?: 'public' | 'private';
}

export function fakeGoogle(o: FakeOptions = {}) {
  const calls: { method: string; url: string; body?: unknown; headers: Record<string, string> }[] = [];
  let uploads = 0;
  const playlistItems: { playlistId: string; videoId: string }[] = [];
  let playlistCreated = false;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = init.body;
    if (typeof init.body === 'string' && headers['content-type']?.includes('json')) body = JSON.parse(init.body);
    calls.push({ method, url, body, headers });

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'refresh_token') return json(200, { access_token: 'ACCESS', expires_in: 3600 });
      return json(200, { access_token: 'ACCESS', refresh_token: 'REFRESH', scope: 'https://www.googleapis.com/auth/youtube' });
    }
    if (headers.authorization !== 'Bearer ACCESS') return json(401, { error: { message: 'no auth' } });
    if (url.includes('/videos?part=status')) {
      const ids = new URL(url).searchParams.get('id')!.split(',');
      return json(200, { items: ids.map((id) => ({ id, status: { privacyStatus: o.laterPrivacy ?? 'public' } })) });
    }
    if (url.includes('/channels?')) return json(200, { items: [{ id: o.channelId ?? 'UCHhHYjq4K0sERPPR2od5kRw', snippet: { title: o.channelTitle ?? 'Blast of Facts' } }] });
    if (url.includes('/playlists?') && method === 'GET') {
      return json(200, { items: o.existingPlaylist || playlistCreated ? [{ id: 'PLmars', snippet: { title: 'Mars Facts for Kids' } }] : [] });
    }
    if (url.includes('/playlists?') && method === 'POST') {
      playlistCreated = true;
      return json(200, { id: 'PLmars' });
    }
    if (url.includes('/playlistItems?')) {
      if (o.failPlaylistAdd) return json(403, { error: { message: 'nope', errors: [{ reason: 'forbidden' }] } });
      const b = body as { snippet: { playlistId: string; resourceId: { videoId: string } } };
      playlistItems.push({ playlistId: b.snippet.playlistId, videoId: b.snippet.resourceId.videoId });
      return json(200, { id: 'PI1' });
    }
    if (url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable')) {
      return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-1' } });
    }
    if (url === 'https://upload.example/session-1' && method === 'PUT') {
      uploads++;
      const id = `VIDEO${String(uploads).padStart(6, '0')}`; // 11 chars
      return json(200, { id, status: { privacyStatus: o.privacyAfterUpload ?? 'public', uploadStatus: 'uploaded' } });
    }
    return json(404, { error: { message: `unexpected ${method} ${url}` } });
  }) as typeof fetch;

  return { fetchFn, calls, playlistItems, uploads: () => uploads };
}
