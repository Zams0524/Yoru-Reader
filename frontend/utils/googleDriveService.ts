import { Capacitor, registerPlugin } from '@capacitor/core';

interface GoogleDriveAuthPlugin {
  authorize(): Promise<{ accessToken: string; expiresInSeconds?: number }>;
}

const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>('GoogleDriveAuth');

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  native?: boolean;
}

export async function authorizeGoogleDriveNative(): Promise<GoogleTokens> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('Native Google Drive authorization is only available in the Android app.');
  }
  const authorization = await GoogleDriveAuth.authorize();
  if (!authorization?.accessToken) throw new Error('Google did not return an access token.');
  return {
    accessToken: authorization.accessToken,
    refreshToken: '',
    expiresAt: Date.now() + Math.max(60, authorization.expiresInSeconds || 3600) * 1000,
    native: true,
  };
}

export interface GoogleDriveUserInfo {
  email: string;
  displayName: string;
}

async function googleErrorMessage(response: Response, fallback: string): Promise<string> {
  const responseText = await response.text().catch(() => '');
  if (responseText) {
    try {
      const data = JSON.parse(responseText);
      const message = data.error?.message || data.error_description || data.error;
      if (message) return `${fallback}: ${message}`;
    } catch {
      return `${fallback}: ${responseText}`;
    }
  }
  return `${fallback} (HTTP ${response.status})`;
}

function driveFilesSearchUrl(fileName: string, fields: string): URL {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  url.search = new URLSearchParams({
    q: `name='${escapedName}' and trashed=false`,
    fields,
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    spaces: 'drive',
  }).toString();
  return url;
}

// OAuth client values come from .env.local (git-ignored) at build time, so the public repo
// does not contain them. See .env.example.
// Google issues a non-confidential client secret for installed desktop clients;
// it is not used for the Android client, which is a public client.
export const DEFAULT_GDRIVE_CLIENT_ID: string = import.meta.env.VITE_GDRIVE_CLIENT_ID || '';
export const DEFAULT_GDRIVE_CLIENT_SECRET: string = import.meta.env.VITE_GDRIVE_CLIENT_SECRET || '';
export const GDRIVE_ANDROID_CLIENT_ID: string = import.meta.env.VITE_GDRIVE_ANDROID_CLIENT_ID || '';
const defaultClientId = DEFAULT_GDRIVE_CLIENT_ID;
const defaultClientSecret = DEFAULT_GDRIVE_CLIENT_SECRET;

function resolveClientSecret(clientId: string, clientSecret: string): string {
  if (clientId.trim() !== defaultClientId && clientSecret.trim() === defaultClientSecret) {
    return '';
  }
  return clientSecret;
}

export const googleDriveService = {
  // Exchange code for tokens
  async exchangeCodeForTokens(
    code: string, 
    redirectUri: string, 
    clientId: string, 
    clientSecret: string = '', 
    codeVerifier: string = ''
  ): Promise<GoogleTokens> {
    const params: Record<string, string> = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    const secret = resolveClientSecret(clientId, clientSecret);
    if (secret) {
      params.client_secret = secret;
    }
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });

    if (!response.ok) throw new Error(await googleErrorMessage(response, 'Google token exchange failed'));

    const data = await response.json();
    if (!data.refresh_token) {
      throw new Error('Google did not provide a refresh token. Remove Yoru Reader from your Google Account access and connect again.');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  },

  // Refresh active token
  async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string = ''): Promise<{ accessToken: string; expiresAt: number }> {
    const params: Record<string, string> = {
      refresh_token: refreshToken,
      client_id: clientId,
      grant_type: 'refresh_token',
    };
    const secret = resolveClientSecret(clientId, clientSecret);
    if (secret) {
      params.client_secret = secret;
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });

    if (!response.ok) throw new Error(await googleErrorMessage(response, 'Google session refresh failed'));

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  },

  // Get active token (refresh if expired)
  async getValidToken(tokens: GoogleTokens, clientId: string, clientSecret: string = ''): Promise<string> {
    if (!tokens) {
      throw new Error('No tokens available');
    }

    if (tokens.accessToken && tokens.expiresAt && Date.now() < tokens.expiresAt - 60000) {
      return tokens.accessToken;
    }

    if (tokens.native && Capacitor.getPlatform() === 'android') {
      try {
        const refreshed = await GoogleDriveAuth.authorize();
        if (!refreshed?.accessToken) throw new Error('Google did not return an access token.');
        tokens.accessToken = refreshed.accessToken;
        tokens.expiresAt = Date.now() + Math.max(60, refreshed.expiresInSeconds || 3600) * 1000;
        localStorage.setItem('gdrive_tokens', JSON.stringify(tokens));
        return refreshed.accessToken;
      } catch (error: any) {
        throw new Error(`${error?.message || 'Google session refresh failed'}. Reconnect Google Drive in Settings.`);
      }
    }

    if (!tokens.refreshToken) {
      throw new Error('Session expired. Please reconnect your Google Drive account.');
    }

    let refreshed: { accessToken: string; expiresAt: number };
    try {
      refreshed = await this.refreshAccessToken(tokens.refreshToken, clientId, clientSecret);
    } catch (error: any) {
      throw new Error(`${error?.message || 'Google session refresh failed'}. Reconnect Google Drive in Settings.`);
    }
    tokens.accessToken = refreshed.accessToken;
    tokens.expiresAt = refreshed.expiresAt;
    localStorage.setItem('gdrive_tokens', JSON.stringify(tokens));
    return refreshed.accessToken;
  },

  // Upload/Update file in Google Drive
  async uploadSyncFile(tokens: GoogleTokens, clientId: string, content: any, clientSecret: string = ''): Promise<any> {
    const accessToken = await this.getValidToken(tokens, clientId, clientSecret);
    
    // 1. Search for existing yoru_reader_sync.json file
    const searchRes = await fetch(
      driveFilesSearchUrl('yoru_reader_sync.json', 'files(id,modifiedTime)'),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!searchRes.ok) throw new Error(await googleErrorMessage(searchRes, 'Could not search for the Yoru sync file in Google Drive'));
    const searchData = await searchRes.json();
    const fileId: string | null = searchData.files?.[0]?.id || null;

    const fileMetadata = {
      name: 'yoru_reader_sync.json',
      mimeType: 'application/json',
    };

    const boundary = 'foo_bar_boundary';
    
    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
      url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
      method = 'PATCH';
    }

    const body = 
      `\r\n--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(fileMetadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(content, null, 2)}\r\n` +
      `--${boundary}--`;

    const uploadRes = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!uploadRes.ok) throw new Error(await googleErrorMessage(uploadRes, 'Google Drive sync upload failed'));

    return await uploadRes.json();
  },

  // Download sync file from Google Drive
  async downloadSyncFile(tokens: GoogleTokens, clientId: string, clientSecret: string = ''): Promise<any> {
    const accessToken = await this.getValidToken(tokens, clientId, clientSecret);

    // 1. Search for yoru_reader_sync.json file
    const searchRes = await fetch(
      driveFilesSearchUrl('yoru_reader_sync.json', 'files(id,modifiedTime)'),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!searchRes.ok) throw new Error(await googleErrorMessage(searchRes, 'Could not search for the Yoru sync file in Google Drive'));

    const data = await searchRes.json();
    if (!data.files || data.files.length === 0) {
      return null;
    }

    const fileId = data.files[0].id;

    // 2. Download file content
    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!downloadRes.ok) {
      throw new Error(await googleErrorMessage(downloadRes, 'Could not download the Yoru sync file from Google Drive'));
    }

    return await downloadRes.json();
  },

  // Get connected user information (email & display name)
  async getUserInfo(tokens: GoogleTokens, clientId: string, clientSecret: string = ''): Promise<GoogleDriveUserInfo> {
    const accessToken = await this.getValidToken(tokens, clientId, clientSecret);
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) throw new Error(await googleErrorMessage(response, 'Could not read the connected Google account'));
    const userInfo = await response.json();
    return {
      email: userInfo.email || userInfo.sub || '',
      displayName: userInfo.name || userInfo.email || '',
    };
  },

  // Upload a binary Blob (e.g. ZIP) to Google Drive
  async uploadBlobFile(
    tokens: GoogleTokens, 
    clientId: string, 
    blob: Blob, 
    fileName: string, 
    mimeType: string, 
    clientSecret: string = ''
  ): Promise<any> {
    const accessToken = await this.getValidToken(tokens, clientId, clientSecret);

    // 1. Search for existing file with the same name
    const searchRes = await fetch(
      driveFilesSearchUrl(fileName, 'files(id,modifiedTime)'),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let fileId: string | null = null;
    if (!searchRes.ok) throw new Error(await googleErrorMessage(searchRes, 'Could not search for the Yoru backup in Google Drive'));
    const searchData = await searchRes.json();
    fileId = searchData.files?.[0]?.id || null;

    // 2. Build multipart body
    const boundary = 'yoru_backup_boundary';
    const metadataStr = JSON.stringify({ name: fileName, mimeType });

    // Convert blob to ArrayBuffer, then combine with metadata in multipart form
    const blobBuffer = await blob.arrayBuffer();
    const encoder = new TextEncoder();

    const preamble = encoder.encode(
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadataStr}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--`);

    const combined = new Uint8Array(preamble.byteLength + blobBuffer.byteLength + epilogue.byteLength);
    combined.set(preamble, 0);
    combined.set(new Uint8Array(blobBuffer), preamble.byteLength);
    combined.set(epilogue, preamble.byteLength + blobBuffer.byteLength);

    // 3. Upload
    const uploadUrl = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const uploadMethod = fileId ? 'PATCH' : 'POST';

    const uploadRes = await fetch(uploadUrl, {
      method: uploadMethod,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    });

    if (!uploadRes.ok) throw new Error(await googleErrorMessage(uploadRes, 'Google Drive backup upload failed'));

    return await uploadRes.json();
  },

  // Download a binary file (e.g. ZIP) from Google Drive by name
  async downloadBlobFile(tokens: GoogleTokens, clientId: string, fileName: string, clientSecret: string = ''): Promise<Blob | null> {
    const accessToken = await this.getValidToken(tokens, clientId, clientSecret);

    // Search for the file by name
    const searchRes = await fetch(
      driveFilesSearchUrl(fileName, 'files(id,name,modifiedTime)'),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!searchRes.ok) throw new Error(await googleErrorMessage(searchRes, 'Could not search for the Yoru backup in Google Drive'));

    const searchData = await searchRes.json();
    if (!searchData.files || searchData.files.length === 0) return null;

    const fileId = searchData.files[0].id;

    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!downloadRes.ok) throw new Error(await googleErrorMessage(downloadRes, 'Could not download the Yoru backup from Google Drive'));

    return await downloadRes.blob();
  }
};

// When this device last synced with Drive, as an ISO timestamp.
export const LAST_SYNC_STORAGE_KEY = 'gdrive_last_sync_time';

export function readLastSyncMs(): number {
  const raw = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
  if (!raw) return 0;
  const ms = Date.parse(raw);
  // Older versions stored toLocaleString(), which Date.parse can't read in most locales.
  // Treat that as "synced just now" so the cloud copy never silently overwrites local data.
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function formatSyncTime(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toLocaleString();
}

// Only a revoked or expired grant means the user must sign in again; anything else
// (offline, timeout, a Google hiccup, the Android picker not answering) is retried later.
export function isGoogleSessionRevoked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant|token has been (expired or )?revoked/i.test(message);
}
