import net from 'net';

/**
 * Checks whether an IP address is a private, loopback, link-local, or reserved address.
 */
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata service e.g. 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (b0 >= 240) return true;
    // Broadcast
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local address (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local address (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // IPv4-mapped IPv6 address (::ffff:127.0.0.1, etc.)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.substring(7);
      if (net.isIPv4(ipv4Part)) {
        return isPrivateIp(ipv4Part);
      }
    }
    return false;
  }

  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'instance-data',
]);

export interface ValidateUrlOptions {
  allowedDomains?: string[]; // e.g. ['youtube.com', 'youtu.be', 'spotify.com']
  allowHttp?: boolean;
}

/**
 * Validates a remote URL to prevent Server-Side Request Forgery (SSRF).
 * Throws an Error with a clear message if the URL is invalid or unsafe.
 */
export function validateSafeUrl(rawUrl: string, options: ValidateUrlOptions = {}): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Invalid URL format');
  }

  // Protocol check: only http and https (default: allow both unless allowHttp === false)
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Unsupported URL protocol: "${protocol}". Only HTTP(S) is permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked localhost & cloud metadata names
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new Error(`Access to local or internal hostname "${hostname}" is forbidden.`);
  }

  // IP address checks
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Access to private IP address "${hostname}" is forbidden.`);
    }
  }

  // Allowed domains filter (if specified)
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    const isDomainAllowed = options.allowedDomains.some((domain) => {
      const target = domain.toLowerCase();
      return hostname === target || hostname.endsWith('.' + target);
    });

    if (!isDomainAllowed) {
      throw new Error(`Hostname "${hostname}" is not an allowed domain (${options.allowedDomains.join(', ')}).`);
    }
  }

  return parsed;
}
