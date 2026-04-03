import type { Prediction } from './types';

const BASE = '/api';

async function post<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Upload audio to Replicate (returns file URI)
export async function uploadAudio(file: File, token?: string): Promise<{ uri: string }> {
  // Convert to ArrayBuffer and send as raw binary
  const buffer = await file.arrayBuffer();
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers,
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  const data = await res.json();
  // Replicate Files API response field name varies; try common candidates
  const uri = (data as any).uri || (data as any).url || (data as any).href
    || (data as any).hrefs?.get || (data as any).id;
  if (!uri) {
    throw new Error(`Unexpected upload response: ${JSON.stringify(data)}`);
  }
  return { uri };
}

// Create prediction
export async function createPrediction(
  model: 'demucs' | 'basic-pitch',
  input: Record<string, unknown>,
  token?: string
): Promise<Prediction> {
  return post<Prediction>('/predict', { action: 'create', model, input }, token);
}

// Poll prediction
export async function pollPrediction(predictionId: string, token?: string): Promise<Prediction> {
  return post<Prediction>('/predict', { action: 'poll', predictionId }, token);
}

// Poll until terminal status (with timeout)
export async function pollUntilDone(
  predictionId: string,
  onProgress?: (status: string) => void,
  timeoutMs = 300_000, // 5 minutes max
  intervalMs = 3000,
  token?: string
): Promise<Prediction> {
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Prediction timed out');
    }

    const prediction = await pollPrediction(predictionId, token);
    onProgress?.(prediction.status);

    if (prediction.status === 'succeeded') return prediction;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(prediction.error || `Prediction ${prediction.status}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Get download URL for MIDI (proxied)
export function getDownloadUrl(fileUrl: string, filename: string, token?: string): string {
  let url = `${BASE}/download?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  return url;
}

// Get download URL for audio stem (proxied)
export function getStemDownloadUrl(fileUrl: string, stemName: string, token?: string): string {
  return getDownloadUrl(fileUrl, `${stemName}.mp3`, token);
}
