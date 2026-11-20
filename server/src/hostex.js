'use strict';

const HOSTEX_API_BASE = 'https://api.hostex.io/v3';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const PAGE_INTERVAL_MS = 300;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [1000, 4000, 15000];
const MAX_IMAGE_DOWNLOAD_BYTES = 10 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IMAGE_EXT_BY_MIME = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

// 去掉 OSS 处理参数（缩略/水印），保证落盘的是无水印原图。
const normalizeImageUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
};

const createHostexClient = ({ token, logger }) => {
  const request = async (path) => {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${HOSTEX_API_BASE}${path}`, {
          headers: { 'Hostex-Access-Token': token, accept: 'application/json' },
          signal: controller.signal
        });

        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Hostex HTTP ${res.status}`);
          if (attempt < RETRY_DELAYS_MS.length) {
            logger.warn({ path, status: res.status, attempt }, 'hostex API retryable error, backing off');
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw lastError;
        }

        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Hostex non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }

        // 封包 error_code 200/0 皆表示成功（实测返回 200）
        if (!res.ok || (json.error_code !== 200 && json.error_code !== 0)) {
          throw new Error(`Hostex API error (HTTP ${res.status}, request_id=${json.request_id || '-'}): ${json.error_msg || text.slice(0, 200)}`);
        }
        return json;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Hostex request failed');
  };

  const listAllReservations = async (params = {}) => {
    const all = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        ...params,
        offset: String(page * PAGE_LIMIT),
        limit: String(PAGE_LIMIT)
      });
      const json = await request(`/reservations?${query}`);
      const batch = json.data?.reservations || [];
      all.push(...batch);
      if (batch.length < PAGE_LIMIT) break;
      await sleep(PAGE_INTERVAL_MS);
    }
    return all;
  };

  const downloadImage = async (url) => {
    const cleanUrl = normalizeImageUrl(url);
    const fetchOnce = async (withAuth) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(cleanUrl, {
          headers: withAuth ? { 'Hostex-Access-Token': token } : {},
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res = await fetchOnce(false);
    if (res.status === 401 || res.status === 403) {
      res = await fetchOnce(true);
    }
    if (!res.ok) {
      throw new Error(`image download failed: HTTP ${res.status}`);
    }

    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = IMAGE_EXT_BY_MIME[contentType];
    if (!ext) {
      throw new Error(`image download rejected: unexpected content-type ${contentType || '(none)'}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`image download rejected: size ${buffer.length} bytes`);
    }
    return { buffer, ext, mime: contentType };
  };

  return { listAllReservations, downloadImage };
};

module.exports = { createHostexClient, normalizeImageUrl };
