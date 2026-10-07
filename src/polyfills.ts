/**
 * Polyfills and compatibility shims for legacy browsers, specifically Safari on iOS 10.3.4+.
 * This file is imported at the very top of src/main.tsx before any React code executes.
 */

// 1. globalThis polyfill
if (typeof globalThis === 'undefined') {
  (window as any).globalThis = window;
}

// 2. Promise.allSettled
if (!(Promise as any).allSettled) {
  (Promise as any).allSettled = function (promises: Iterable<any>) {
    return Promise.all(
      Array.from(promises).map(p =>
        Promise.resolve(p).then(
          value => ({ status: 'fulfilled', value }),
          reason => ({ status: 'rejected', reason })
        )
      )
    );
  };
}

// 3. Promise.prototype.finally
if (!(Promise.prototype as any).finally) {
  (Promise.prototype as any).finally = function (callback: () => void) {
    const P = this.constructor || Promise;
    return this.then(
      (value: any) => P.resolve(callback()).then(() => value),
      (reason: any) => P.resolve(callback()).then(() => { throw reason; })
    );
  };
}

// 4. Object.fromEntries
if (!(Object as any).fromEntries) {
  (Object as any).fromEntries = function (entries: any) {
    if (!entries) return {};
    const obj: any = {};
    for (const [key, val] of entries) {
      obj[key] = val;
    }
    return obj;
  };
}

// 5. Object.values and Object.entries (iOS 10.0-10.2 compatibility)
if (!Object.values) {
  (Object as any).values = function (obj: any) {
    if (obj == null) throw new TypeError('Cannot convert undefined or null to object');
    return Object.keys(obj).map(function (key) { return obj[key]; });
  };
}

if (!Object.entries) {
  (Object as any).entries = function (obj: any) {
    if (obj == null) throw new TypeError('Cannot convert undefined or null to object');
    return Object.keys(obj).map(function (key) { return [key, obj[key]]; });
  };
}

// 6. String.prototype.replaceAll
if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (searchValue: any, replaceValue: any): string {
    if (searchValue instanceof RegExp) {
      return this.replace(searchValue, replaceValue);
    }
    const escaped = String(searchValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.replace(new RegExp(escaped, 'g'), replaceValue);
  };
}

// 7. String.prototype.padStart and padEnd (Safari 10 compatibility)
if (!String.prototype.padStart) {
  String.prototype.padStart = function (targetLength: number, padString?: string): string {
    targetLength = targetLength >> 0;
    padString = String(typeof padString !== 'undefined' ? padString : ' ');
    if (this.length >= targetLength) {
      return String(this);
    }
    targetLength = targetLength - this.length;
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length);
    }
    return padString.slice(0, targetLength) + String(this);
  };
}

if (!String.prototype.padEnd) {
  String.prototype.padEnd = function (targetLength: number, padString?: string): string {
    targetLength = targetLength >> 0;
    padString = String(typeof padString !== 'undefined' ? padString : ' ');
    if (this.length >= targetLength) {
      return String(this);
    }
    targetLength = targetLength - this.length;
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length);
    }
    return String(this) + padString.slice(0, targetLength);
  };
}

// 8. Array.prototype.flat and flatMap
if (!(Array.prototype as any).flat) {
  (Array.prototype as any).flat = function (depth = 1): any[] {
    const d = typeof depth === 'number' ? depth : 1;
    const arr: any[] = this as any;
    return d > 0
      ? arr.reduce((acc: any[], val: any) => acc.concat(Array.isArray(val) ? (val as any).flat(d - 1) : val), [])
      : arr.slice();
  };
}
if (!(Array.prototype as any).flatMap) {
  (Array.prototype as any).flatMap = function (callback: any, thisArg: any): any[] {
    const arr: any[] = this as any;
    return (arr.map(callback, thisArg) as any).flat(1);
  };
}

// 9. Element.prototype.closest
if (typeof Element !== 'undefined' && !Element.prototype.closest) {
  Element.prototype.closest = function (s: string) {
    var el: any = this;
    do {
      if ((el.matches || (el as any).webkitMatchesSelector).call(el, s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

// 10. URLSearchParams fallback
if (typeof window !== 'undefined' && typeof window.URLSearchParams === 'undefined') {
  class URLSearchParamsPolyfill {
    private params = new Map<string, string>();

    constructor(init?: string | Record<string, string> | URLSearchParamsPolyfill) {
      if (!init) return;
      if (typeof init === 'string') {
        let query = init;
        if (query.startsWith('?')) query = query.slice(1);
        const pairs = query.split('&');
        for (const pair of pairs) {
          if (!pair) continue;
          const [key, val] = pair.split('=');
          if (key) {
            this.params.set(
              decodeURIComponent(key.replace(/\+/g, ' ')),
              val ? decodeURIComponent(val.replace(/\+/g, ' ')) : ''
            );
          }
        }
      } else if (init instanceof URLSearchParamsPolyfill) {
        init.forEach((val, key) => this.params.set(key, val));
      } else if (typeof init === 'object') {
        for (const key of Object.keys(init)) {
          this.params.set(key, String((init as any)[key]));
        }
      }
    }

    get(name: string): string | null {
      return this.params.get(name) ?? null;
    }

    set(name: string, value: string): void {
      this.params.set(name, value);
    }

    append(name: string, value: string): void {
      this.params.set(name, value);
    }

    delete(name: string): void {
      this.params.delete(name);
    }

    has(name: string): boolean {
      return this.params.has(name);
    }

    toString(): string {
      const parts: string[] = [];
      this.params.forEach((value, key) => {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      });
      return parts.join('&');
    }

    forEach(callback: (value: string, key: string) => void): void {
      this.params.forEach(callback);
    }
  }

  (window as any).URLSearchParams = URLSearchParamsPolyfill;
}

// 11. crypto.randomUUID
if (typeof window !== 'undefined' && typeof window.crypto !== 'undefined' && !window.crypto.randomUUID) {
  window.crypto.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }) as `${string}-${string}-${string}-${string}-${string}`;
  };
}

// 12. CustomEvent constructor for older WebKit
if (typeof window !== 'undefined' && typeof (window as any).CustomEvent !== 'function') {
  function CustomEventPolyfill(event: string, params?: { bubbles?: boolean; cancelable?: boolean; detail?: any }) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    const evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles || false, params.cancelable || false, params.detail);
    return evt;
  }
  CustomEventPolyfill.prototype = (window as any).Event.prototype;
  (window as any).CustomEvent = CustomEventPolyfill;
}

// 13. ResizeObserver polyfill / shim
if (typeof window !== 'undefined' && typeof (window as any).ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    private callback: (entries: any[], observer: any) => void;
    private targets = new Set<Element>();
    private listener: () => void;

    constructor(callback: (entries: any[], observer: any) => void) {
      this.callback = callback;
      this.listener = () => {
        const entries = Array.from(this.targets).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            target: el,
            contentRect: rect,
            borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
            contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          };
        });
        if (entries.length > 0) {
          try {
            this.callback(entries, this);
          } catch (e) {
            console.warn('[ResizeObserver Polyfill] Error during callback:', e);
          }
        }
      };
      window.addEventListener('resize', this.listener);
      window.addEventListener('orientationchange', this.listener);
    }

    observe(target: Element) {
      if (target) {
        this.targets.add(target);
        requestAnimationFrame(this.listener);
      }
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
      window.removeEventListener('resize', this.listener);
      window.removeEventListener('orientationchange', this.listener);
    }
  }

  (window as any).ResizeObserver = ResizeObserverPolyfill;
}

// 14. IntersectionObserver polyfill / shim
if (typeof window !== 'undefined' && typeof (window as any).IntersectionObserver === 'undefined') {
  class IntersectionObserverPolyfill {
    private callback: (entries: any[], observer: any) => void;
    private targets = new Set<Element>();

    constructor(callback: (entries: any[], observer: any) => void) {
      this.callback = callback;
    }

    observe(target: Element) {
      if (target) {
        this.targets.add(target);
        requestAnimationFrame(() => {
          try {
            this.callback([
              {
                isIntersecting: true,
                target,
                intersectionRatio: 1,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
                time: Date.now(),
              }
            ], this);
          } catch (e) {}
        });
      }
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
    }
  }

  (window as any).IntersectionObserver = IntersectionObserverPolyfill;
}

// 15. Clipboard API fallback
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  if (!navigator.clipboard) {
    (navigator as any).clipboard = {
      writeText: async (text: string): Promise<void> => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return Promise.resolve();
        } catch (err) {
          return Promise.reject(err);
        }
      },
      readText: async (): Promise<string> => {
        return Promise.resolve('');
      }
    };
  }
}

// 16. Flex Gap detection & Mobile Safari Viewport Height fix
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  function checkFlexGapSupport() {
    try {
      const flex = document.createElement('div');
      flex.style.display = 'flex';
      flex.style.flexDirection = 'column';
      flex.style.rowGap = '1px';
      flex.appendChild(document.createElement('div'));
      flex.appendChild(document.createElement('div'));
      document.body.appendChild(flex);
      const isSupported = flex.scrollHeight === 1;
      document.body.removeChild(flex);
      if (!isSupported) {
        document.documentElement.classList.add('no-flex-gap');
      }
    } catch (e) {
      document.documentElement.classList.add('no-flex-gap');
    }
  }

  function setViewportHeight() {
    try {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkFlexGapSupport();
      setViewportHeight();
    });
  } else {
    checkFlexGapSupport();
    setViewportHeight();
  }

  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', setViewportHeight);
}

export {};
