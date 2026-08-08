import * as https from 'https';

export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SpotifyTrackMetadata {
  id: string;
  title: string;
  artist: string;
  /** All artists joined with ", " */
  allArtists: string;
  /** Seconds */
  duration: number;
  thumbnail: string | null;
  albumName: string | null;
}

// Cached per clientId so multiple callers (e.g. concurrent worker jobs) in the
// same process reuse one token instead of re-authenticating every request.
const tokenCache = new Map<string, { token: string; expiry: number }>();

/**
 * Get a Spotify access token via the Client Credentials flow.
 */
export async function getSpotifyAccessToken(creds: SpotifyCredentials): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Spotify credentials not configured (clientId/clientSecret missing)');
  }

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const postData = 'grant_type=client_credentials';

    const options: https.RequestOptions = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const json = JSON.parse(data);
            // Token is valid for 1 hour; cache for 50 minutes to be safe.
            tokenCache.set(creds.clientId, {
              token: json.access_token,
              expiry: Date.now() + 50 * 60 * 1000,
            });
            resolve(json.access_token);
          } else {
            reject(new Error(`Spotify auth failed: ${res.statusCode} ${data}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Spotify auth request failed: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch track metadata from the Spotify Web API.
 */
export async function fetchSpotifyTrackMetadata(
  trackId: string,
  creds: SpotifyCredentials
): Promise<SpotifyTrackMetadata> {
  const token = await getSpotifyAccessToken(creds);

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.spotify.com',
      path: `/v1/tracks/${trackId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const json = JSON.parse(data);
            const metadata: SpotifyTrackMetadata = {
              id: json.id,
              title: json.name,
              artist: json.artists?.length > 0 ? json.artists[0].name : 'Unknown Artist',
              allArtists: json.artists ? json.artists.map((a: { name: string }) => a.name).join(', ') : 'Unknown Artist',
              duration: Math.round(json.duration_ms / 1000),
              thumbnail: json.album?.images?.length > 0 ? json.album.images[0].url : null,
              albumName: json.album ? json.album.name : null,
            };
            resolve(metadata);
          } else if (res.statusCode === 404) {
            reject(new Error('Spotify track not found'));
          } else {
            reject(new Error(`Spotify API error: ${res.statusCode} ${data}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Spotify API request failed: ${err.message}`)));
    req.end();
  });
}
