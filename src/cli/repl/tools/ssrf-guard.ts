/**
 * SSRF（服务器端请求伪造）防护模块
 *
 * 三层防护策略：
 * 1. URL 解析层 — hostname 黑名单匹配
 * 2. DNS 解析层 — DNS 查询后检查 IP 是否属于保留地址段
 * 3. 协议层 — 仅允许 http/https
 *
 * 参考实现: OpenClaw src/infra/net/ssrf.ts
 *
 * @module cli/repl/tools/ssrf-guard
 */

import { lookup as dnsLookup } from 'node:dns/promises';

// ============ 类型定义 ============

/** SSRF 检查结果 */
export interface SsrfCheckResult {
  /** 是否通过安全检查 */
  allowed: boolean;
  /** 被阻止的原因 */
  reason?: string;
}

/** SSRF 防护选项 */
export interface SsrfGuardOptions {
  /** 是否允许访问私有网络地址 */
  allowPrivateNetwork?: boolean;
  /** 域名白名单（支持 *.example.com 通配符） */
  allowedDomains?: string[];
  /** 域名黑名单 */
  blockedDomains?: string[];
}

// ============ 常量 ============

/** 默认被阻止的 hostname */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

/**
 * IPv4/IPv6 保留和特殊用途地址段 (CIDR)
 *
 * 格式: [networkAddress, prefixBits]
 */
const PRIVATE_IP_RANGES: Array<[string, number]> = [
  // IPv4
  ['127.0.0.0', 8], // loopback
  ['10.0.0.0', 8], // RFC1918 private
  ['172.16.0.0', 12], // RFC1918 private
  ['192.168.0.0', 16], // RFC1918 private
  ['169.254.0.0', 16], // link-local
  ['100.64.0.0', 10], // Carrier-grade NAT (RFC6598)
  ['198.18.0.0', 15], // Benchmark testing (RFC2544)
  ['0.0.0.0', 8], // Current network
  // IPv6
  ['::1', 128], // loopback
  ['fc00::', 7], // Unique local
  ['fe80::', 10], // Link-local
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
];

// ============ hostname 检查 ============

/**
 * 检查 hostname 是否在黑名单中
 */
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) {
    return true;
  }
  // *.localhost, *.local, *.internal
  if (lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }
  return false;
}

/**
 * 通配符域名匹配
 *
 * 支持 *.example.com 格式
 */
function matchDomainPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    if (!suffix || hostname === suffix) {
      return false;
    }
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

/**
 * 检查 hostname 是否匹配白名单/黑名单
 */
function checkHostnamePolicy(
  hostname: string,
  options: SsrfGuardOptions
): { allowed: boolean; reason?: string } {
  // 先检查黑名单
  if (isBlockedHostname(hostname)) {
    return { allowed: false, reason: `被阻止的 hostname: ${hostname}` };
  }

  // 再检查白名单（如果配置了的话）
  const allowedList = options.allowedDomains ?? [];
  const blockedList = options.blockedDomains ?? [];

  for (const pattern of blockedList) {
    if (matchDomainPattern(hostname, pattern)) {
      return { allowed: false, reason: `域名黑名单匹配: ${hostname} 匹配 ${pattern}` };
    }
  }

  if (allowedList.length > 0) {
    const isAllowed = allowedList.some((pattern) => matchDomainPattern(hostname, pattern));
    if (!isAllowed) {
      return { allowed: false, reason: `不在域名白名单中: ${hostname}` };
    }
  }

  return { allowed: true };
}

// ============ IP 地址检查 ============

/**
 * 将 IPv4 地址字符串转为 32 位整数
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) {
      return null;
    }
    result = (result << 8) | num;
  }
  return result >>> 0; // 无符号右移确保为正整数
}

/**
 * 检查 IP 地址是否在给定的 CIDR 范围内
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length < 2) {
    return false;
  }
  const range = parts[0] ?? '';
  const prefix = parseInt(parts[1] ?? '32', 10);
  if (Number.isNaN(prefix)) {
    return false;
  }

  if (ip.includes(':')) {
    // IPv6 简化处理：使用 BigInt 比较
    try {
      const ipBigInt = parseIpv6ToBigInt(ip);
      const rangeBigInt = parseIpv6ToBigInt(range);
      if (ipBigInt === null || rangeBigInt === null) {
        return false;
      }
      const mask = prefix === 0 ? 0n : (2n ** BigInt(128) - 1n) << BigInt(128 - prefix);
      return (ipBigInt & mask) === (rangeBigInt & mask);
    } catch {
      return false;
    }
  }

  // IPv4
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) {
    return false;
  }
  const rangeInt = ipv4ToInt(range);
  if (rangeInt === null) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = prefix >= 32 ? 0xffffffff : (~0 >>> (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * 简化的 IPv6 → BigInt 转换（处理标准格式）
 */
function parseIpv6ToBigInt(ip: string): bigint | null {
  try {
    // 展开简写 :: 为全零组
    const expanded = ip.includes('::')
      ? ip.replace('::', `::${':'.repeat(ip.split(':').length < 8 ? 8 - ip.split(':').length : 0)}`)
      : ip;
    const parts = expanded.split(':');
    if (parts.length !== 8) {
      return null;
    }
    let result = 0n;
    for (const part of parts) {
      // 空字符串对应 :: 展开后的全零段，应视为 0
      const value = part === '' ? 0 : parseInt(part, 16);
      if (Number.isNaN(value)) {
        return null;
      }
      result = (result << 16n) + BigInt(value);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * 检查 IP 地址是否为私有/保留地址
 */
function isPrivateIp(ip: string): boolean {
  for (const entry of PRIVATE_IP_RANGES) {
    const range = entry[0];
    const prefix = entry[1] ?? 32;
    if (range && ipInCidr(ip, `${range}/${String(prefix)}`)) {
      return true;
    }
  }
  return false;
}

// ============ DNS 解析后校验 ============

/**
 * 检查 DNS 解析结果中的 IP 是否全部为公网地址
 */
async function checkResolvedAddresses(
  addresses: string[],
  options: SsrfGuardOptions
): Promise<{ allowed: boolean; reason?: string }> {
  if (options.allowPrivateNetwork) {
    return { allowed: true };
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return {
        allowed: false,
        reason: `DNS 解析到私有/保留 IP 地址: ${addr}（可能为 SSRF 攻击）`,
      };
    }
  }

  return { allowed: true };
}

// ============ 主入口 ============

/**
 * 检查 URL 是否可安全访问（SSRF 防护）
 *
 * @param url - 要检查的 URL
 * @param options - 防护选项
 * @returns 检查结果
 */
export async function checkUrlSafety(
  url: string,
  options: SsrfGuardOptions = {}
): Promise<SsrfCheckResult> {
  // Step 1: URL 解析和协议检查
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: `无效的 URL: ${url}` };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: `不允许的协议: ${parsed.protocol}（仅支持 http/https）` };
  }

  const hostname = parsed.hostname;

  // Step 2: hostname 黑名单/白名单检查
  const hostnameResult = checkHostnamePolicy(hostname, options);
  if (!hostnameResult.allowed) {
    return hostnameResult;
  }

  // Step 3: DNS 解析 + IP 地址检查
  try {
    const lookupResult = await dnsLookup(hostname, { verbatim: true });
    // lookup 返回 LookupAddress 对象，address 可能是字符串或字符串数组
    const rawAddress: string | string[] = lookupResult.address;
    const addresses: string[] = Array.isArray(rawAddress) ? rawAddress : [rawAddress];
    const ipResult = await checkResolvedAddresses(addresses, options);
    if (!ipResult.allowed) {
      return ipResult;
    }
  } catch (_err) {
    // DNS 解析失败：对于无法解析的 hostname，视配置决定
    if (!options.allowPrivateNetwork) {
      return {
        allowed: false,
        reason: `DNS 解析失败且不允许私有网络访问: ${hostname}`,
      };
    }
    // 如果允许私有网络，DNS 失败不阻断（可能是临时网络问题）
  }

  return { allowed: true };
}
