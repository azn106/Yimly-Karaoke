export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'tv';

export interface DeviceSignals {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  width: number;
  height: number;
  coarsePointer: boolean;
}

/**
 * Best-effort device classification for UI hints and diagnostics.
 * Layout sizing must still follow the live viewport, not this classification:
 * iPads can request desktop sites and hybrid PCs may have touchscreens.
 */
export function classifyDevice(signals: DeviceSignals): DeviceType {
  const ua = signals.userAgent.toLowerCase();
  const platform = signals.platform.toLowerCase();

  // Prefer explicit smart-TV browser/platform hints; screen dimensions alone
  // are not enough to distinguish a television from a desktop monitor.
  if (
    /smart[- ]?tv|hbbtv|tizen|web0s|webos|netcast|googletv|android tv|aft[a-z0-9]*|bravia|viera|appletv/.test(ua) ||
    /tizen|webos|web0s/.test(platform)
  ) {
    return 'tv';
  }

  // iPadOS may report itself as a Mac when requesting a desktop website.
  const isIPad = /ipad/.test(ua) ||
    (platform === 'macintel' && signals.maxTouchPoints > 1);
  const isTabletUA =
    /tablet|kindle|silk|playbook/.test(ua) ||
    (/android/.test(ua) && !/mobile/.test(ua));

  if (isIPad || isTabletUA) return 'tablet';

  if (/iphone|ipod|windows phone|android.*mobile|mobile/.test(ua)) {
    return 'phone';
  }

  // When UA hints are inconclusive, use touch and viewport as a fallback.
  if (signals.coarsePointer && signals.maxTouchPoints > 0) {
    if (signals.width < 600) return 'phone';
    if (signals.width < 1100) return 'tablet';
  }

  return 'desktop';
}

export function detectDeviceType(): DeviceType {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'desktop';
  }

  return classifyDevice({
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches,
  });
}
