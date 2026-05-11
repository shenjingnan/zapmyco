/**
 * sandbox-policy-validator 单元测试
 */
import { describe, expect, it } from 'vitest';
import { validateSandboxPolicy } from '@/security/sandbox/policy-validator';
import type { SandboxConfig } from '@/security/types';

function createConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    enabled: true,
    backend: 'none',
    filesystem: {
      projectMount: 'readonly',
      blockedHostPaths: ['/', '/etc', '/proc', '/sys', '/dev', '/boot', '/root'],
    },
    network: {
      mode: 'none',
    },
    maxLifetimeSec: 3600,
    ...overrides,
  };
}

describe('validateSandboxPolicy', () => {
  describe('valid configs', () => {
    it('should pass a safe config with readonly mount', () => {
      const config = createConfig();
      const violations = validateSandboxPolicy(config);
      expect(violations).toEqual([]);
    });

    it('should pass a safe config with projectMount "none"', () => {
      const config = createConfig({
        filesystem: {
          projectMount: 'none',
          blockedHostPaths: [],
        },
      });
      const violations = validateSandboxPolicy(config);
      // none mode doesn't need blocked paths
      expect(violations.filter((v) => v.severity === 'error')).toEqual([]);
    });
  });

  describe('dangerous configs', () => {
    it('should error on missing blocked host paths', () => {
      const config = createConfig({
        filesystem: {
          projectMount: 'readonly',
          blockedHostPaths: ['/etc'],
        },
      });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.severity === 'error')).toBe(true);
    });

    it('should warn on readwrite project mount', () => {
      const config = createConfig({
        filesystem: {
          projectMount: 'readwrite',
          blockedHostPaths: ['/', '/etc', '/proc', '/sys', '/dev', '/boot', '/root'],
        },
      });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'filesystem.projectMount')).toBe(true);
    });

    it('should warn on excessive maxLifetimeSec', () => {
      const config = createConfig({ maxLifetimeSec: 7200 });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'maxLifetimeSec')).toBe(true);
    });

    it('should error on maxLifetimeSec > 24h', () => {
      const config = createConfig({ maxLifetimeSec: 100000 });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'maxLifetimeSec' && v.severity === 'error')).toBe(
        true
      );
    });

    it('should warn on restricted network without allowedDomains', () => {
      const config = createConfig({
        network: {
          mode: 'restricted',
          allowedDomains: [],
        },
      });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'network.allowedDomains')).toBe(true);
    });

    it('should pass restricted network with allowedDomains', () => {
      const config = createConfig({
        network: {
          mode: 'restricted',
          allowedDomains: ['api.github.com'],
        },
      });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'network.allowedDomains')).toBe(false);
    });

    it('should warn when docker backend is selected', () => {
      const config = createConfig({ backend: 'docker' });
      const violations = validateSandboxPolicy(config);
      expect(violations.some((v) => v.field === 'backend')).toBe(true);
    });
  });

  describe('multiple violations', () => {
    it('should report all violations', () => {
      const config = createConfig({
        backend: 'docker',
        maxLifetimeSec: 7200,
        filesystem: {
          projectMount: 'readwrite',
          blockedHostPaths: ['/etc'],
        },
      });
      const violations = validateSandboxPolicy(config);
      expect(violations.length).toBeGreaterThanOrEqual(3);
    });
  });
});
