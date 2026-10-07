/**
 * Authentication persistence and HTTP header management.
 * Provides safe storage access with in-memory fallback for legacy browsers
 * (such as Safari on iOS 10 in Private Browsing mode where localStorage throws).
 */

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window !== 'undefined' && (window as any).__yimly_token) {
    memoryToken = (window as any).__yimly_token;
    return memoryToken;
  }
  try {
    const stored = localStorage.getItem('yimly_token');
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch (e) {
    // Safari Private Browsing mode or storage restricted
  }
  try {
    const stored = sessionStorage.getItem('yimly_token');
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch (e) {}
  return null;
}

export function setAuthToken(token: string): void {
  if (!token) return;
  memoryToken = token;
  if (typeof window !== 'undefined') {
    (window as any).__yimly_token = token;
  }
  try {
    localStorage.setItem('yimly_token', token);
  } catch (e) {
    console.warn('[AUTH] localStorage.setItem failed, using fallback:', e);
  }
  try {
    sessionStorage.setItem('yimly_token', token);
  } catch (e) {}
}

export function clearAuthToken(): void {
  memoryToken = null;
  if (typeof window !== 'undefined') {
    delete (window as any).__yimly_token;
  }
  try {
    localStorage.removeItem('yimly_token');
  } catch (e) {}
  try {
    sessionStorage.removeItem('yimly_token');
  } catch (e) {}
}

/**
 * Patch window.fetch once at startup so that all relative API requests
 * automatically include the Authorization Bearer header if a token exists,
 * and explicitly specify credentials: 'same-origin' for iOS 10 WebKit browsers.
 * This guarantees Safari 10 and mobile browsers stay authenticated.
 */
let isFetchPatched = false;

export function initAuthFetchInterceptor(): void {
  if (isFetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  isFetchPatched = true;

  const originalFetch = window.fetch;

  const authFetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let urlString = '';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.toString();
    } else if (input && typeof input === 'object' && 'url' in input) {
      urlString = (input as Request).url;
    }

    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
    const isApiCall = urlString.startsWith('/api/') || 
                      urlString.startsWith('api/') ||
                      urlString.includes('/api/') ||
                      (Boolean(origin) && urlString.startsWith(origin + '/api/'));

    if (isApiCall) {
      init = init ? { ...init } : {};

      // iOS 10 WebKit defaults fetch credentials to 'omit'.
      // Explicit 'same-origin' ensures cookies are sent with API calls.
      if (!init.credentials) {
        init.credentials = 'same-origin';
      }

      const token = getAuthToken();
      if (token) {
        if (!init.headers) {
          init.headers = { 'Authorization': `Bearer ${token}` };
        } else if (init.headers instanceof Headers) {
          if (!init.headers.has('Authorization')) {
            init.headers.set('Authorization', `Bearer ${token}`);
          }
        } else if (Array.isArray(init.headers)) {
          const hasAuth = init.headers.some(([k]) => k.toLowerCase() === 'authorization');
          if (!hasAuth) {
            init.headers.push(['Authorization', `Bearer ${token}`]);
          }
        } else if (typeof init.headers === 'object') {
          const headersRecord = init.headers as Record<string, string>;
          const hasAuth = Object.keys(headersRecord).some(k => k.toLowerCase() === 'authorization');
          if (!hasAuth) {
            init.headers = { ...headersRecord, 'Authorization': `Bearer ${token}` };
          }
        }
      }
    }

    return originalFetch.call(this, input, init);
  };

  let patched = false;
  try {
    // Direct property assignment works on standard browsers and Safari 10 (iOS 10)
    (window as any).fetch = authFetch;
    patched = true;
  } catch (err) {
    // In restricted environments like sandboxed iframes where window.fetch has a locked getter
  }

  if (!patched) {
    try {
      if (typeof Window !== 'undefined' && Window.prototype) {
        (Window.prototype as any).fetch = authFetch;
        patched = true;
      }
    } catch (e2) {}
  }

  if (!patched) {
    try {
      const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
      if (!desc || desc.configurable || desc.writable) {
        Object.defineProperty(window, 'fetch', {
          value: authFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        patched = true;
      }
    } catch (err) {
      console.warn('[AUTH] window.fetch could not be redefined with Object.defineProperty:', err);
    }
  }
}

// Initialize immediately upon module import
initAuthFetchInterceptor();
