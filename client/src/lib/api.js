const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(method, path, body, options = {}) {
  const init = {
    method,
    credentials: 'include',
    headers: { ...(options.headers || {}) },
  };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { ...JSON_HEADERS, ...init.headers };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else if (options.raw) {
    data = await res.text();
  } else {
    data = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || (data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data && data.details ? data.details : null;
    err.validation = data && data.validation ? data.validation : null;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

export function qs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v);
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}
