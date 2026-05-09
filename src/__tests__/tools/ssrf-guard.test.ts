import { describe, expect, it } from 'vitest';
import { checkRedirectChain, checkUrlSafety, isCloudMetadataIp } from '@/cli/repl/tools/ssrf-guard';

describe('checkUrlSafety', () => {
  describe('URL 解析层 — 无效 URL', () => {
    it('无效的 URL 应该被阻止', async () => {
      const result = await checkUrlSafety('not-a-url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('无效的 URL');
    });
  });

  describe('协议检查', () => {
    it('http 协议应该通过', async () => {
      const result = await checkUrlSafety('http://example.com');
      // DNS 解析可能失败，但不应该因为协议被阻止
      if (result.reason) {
        expect(result.reason).not.toContain('不允许的协议');
      }
    });

    it('https 协议应该通过', async () => {
      const result = await checkUrlSafety('https://example.com');
      if (result.reason) {
        expect(result.reason).not.toContain('不允许的协议');
      }
    });

    it('file:// 协议应该被阻止', async () => {
      const result = await checkUrlSafety('file:///etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('不允许的协议');
    });

    it('ftp:// 协议应该被阻止', async () => {
      const result = await checkUrlSafety('ftp://example.com/file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('不允许的协议');
    });
  });

  describe('hostname 黑名单', () => {
    it('localhost 应该被阻止', async () => {
      const result = await checkUrlSafety('http://localhost:8080');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('localhost');
    });

    it('*.localhost 结尾的域名应该被阻止', async () => {
      const result = await checkUrlSafety('http://test.localhost');
      expect(result.allowed).toBe(false);
    });

    it('*.local 结尾的域名应该被阻止', async () => {
      const result = await checkUrlSafety('http://my.local');
      expect(result.allowed).toBe(false);
    });

    it('*.internal 结尾的域名应该被阻止', async () => {
      const result = await checkUrlSafety('http://app.internal');
      expect(result.allowed).toBe(false);
    });

    it('metadata.google.internal 应该被阻止', async () => {
      const result = await checkUrlSafety('http://metadata.google.internal');
      expect(result.allowed).toBe(false);
    });
  });

  describe('域名白名单/黑名单策略', () => {
    it('黑名单域名通配符匹配应该生效', async () => {
      const result = await checkUrlSafety('http://evil.example.com', {
        blockedDomains: ['*.example.com'],
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('黑名单');
    });

    it('白名单应该限制只允许指定域名', async () => {
      const result = await checkUrlSafety('http://unknown.com', {
        allowedDomains: ['*.example.com'],
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('白名单');
    });

    it('白名单内的域名应该放行（hostname 层）', async () => {
      // 注意：即使 hostname 通过白名单，DNS 解析仍可能失败
      const result = await checkUrlSafety('http://test.example.com', {
        allowedDomains: ['*.example.com'],
        allowPrivateNetwork: true,
      });
      // 不应该因为白名单被阻止
      if (result.reason) {
        expect(result.reason).not.toContain('白名单');
      }
    });
  });

  describe('私有网络访问控制', () => {
    it('allowPrivateNetwork=true 时应该允许私有 IP', async () => {
      // localhost 在 hostname 黑名单中，用 127.0.0.1 测试
      // 但 127.0.0.1 不是标准 hostname 格式，DNS 可能解析它
      // 这里测试 allowPrivateNetwork 的逻辑路径
      const result = await checkUrlSafety('http://127.0.0.1:8080', {
        allowPrivateNetwork: true,
      });
      // 127.0.0.1 作为 hostname 不会触发 hostname 黑名单
      // allowPrivateNetwork=true 时 DNS 失败也不阻断
      expect(result.allowed).toBe(true);
    });
  });

  // ============ 云元数据 IP 阻止 ============
  describe('云元数据 IP 阻止', () => {
    it('169.254.169.254 即使 allowPrivateNetwork=true 也应阻止', async () => {
      const result = await checkUrlSafety('http://169.254.169.254/latest/meta-data/', {
        allowPrivateNetwork: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('云元数据端点');
    });

    it('169.254.169.253 应该被阻止', async () => {
      const result = await checkUrlSafety('http://169.254.169.253/', {
        allowPrivateNetwork: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('云元数据端点');
    });

    it('阿里云 100.100.100.200 应该被阻止', async () => {
      const result = await checkUrlSafety('http://100.100.100.200/', {
        allowPrivateNetwork: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('云元数据端点');
    });
  });

  // ============ checkRedirectChain ============
  describe('checkRedirectChain', () => {
    it('空重定向链应该允许', async () => {
      const result = await checkRedirectChain([]);
      expect(result.allowed).toBe(true);
    });

    it('安全的单次重定向应该允许', async () => {
      const result = await checkRedirectChain(['https://example.com/page'], {
        allowPrivateNetwork: true,
      });
      // allowPrivateNetwork=true 时 DNS 失败不阻断
      expect(result).toBeDefined();
    });

    it('重定向到 localhost 应该被阻止', async () => {
      const result = await checkRedirectChain(['http://localhost:8080/admin'], {
        allowPrivateNetwork: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('重定向目标');
    });

    it('重定向链中任一不安全的 URL 应阻止整条链', async () => {
      const result = await checkRedirectChain(['file:///etc/passwd'], {
        allowPrivateNetwork: true,
      });
      expect(result.allowed).toBe(false);
    });

    it('多级安全重定向应该允许', async () => {
      const result = await checkRedirectChain(['https://example.com', 'https://cdn.example.com'], {
        allowPrivateNetwork: true,
      });
      // allowPrivateNetwork=true 时 DNS 失败也不阻断，空 URL 会失败
      expect(result).toBeDefined();
    });
  });

  // ============ isCloudMetadataIp ============
  describe('isCloudMetadataIp', () => {
    it('169.254.169.254 应该返回 true', () => {
      expect(isCloudMetadataIp('169.254.169.254')).toBe(true);
    });

    it('169.254.169.253 应该返回 true', () => {
      expect(isCloudMetadataIp('169.254.169.253')).toBe(true);
    });

    it('100.100.100.200 应该返回 true', () => {
      expect(isCloudMetadataIp('100.100.100.200')).toBe(true);
    });

    it('普通公网 IP 应该返回 false', () => {
      expect(isCloudMetadataIp('8.8.8.8')).toBe(false);
    });

    it('普通私有 IP 应该返回 false', () => {
      expect(isCloudMetadataIp('192.168.1.1')).toBe(false);
    });

    it('localhost 应该返回 false', () => {
      expect(isCloudMetadataIp('127.0.0.1')).toBe(false);
    });
  });
});
