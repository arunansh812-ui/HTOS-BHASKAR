import { useEffect, useRef } from 'react';

const TOKEN_KEY = 'sja_auth_token';

export const MAX_UPLOAD_PDF_BYTES = 18 * 1024 * 1024; // 18 MB raw PDF stays safely under 32 MiB Base64 JSON limit

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers,
  });

  if (res.status === 413) {
    throw new Error('Uploaded file is too large for transmission. Please keep PDFs under 18 MB.');
  }

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      data = {
        error:
          stripped.length > 0 && stripped.length < 240
            ? stripped
            : `Server returned an unexpected response (${res.status}).`,
      };
    }
  }

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return data as T;
}

export function useAutoRefresh(
  onRefresh: () => void | Promise<void>,
  enabled = true,
  intervalMs = 15000
): void {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    const trigger = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void cbRef.current();
    };

    const onVisibility = () => {
      if (!document.hidden) trigger();
    };

    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = intervalMs > 0 ? window.setInterval(trigger, intervalMs) : null;

    return () => {
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export async function downloadPdfFile(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to download PDF file.');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*?=(?:UTF-8''|"?)([^";\n]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function downloadAuthFile(url: string, fallbackFilename: string): Promise<void> {
  const token = getAuthToken();
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to download attached document.');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*?=(?:UTF-8''|"?)([^";\n]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
