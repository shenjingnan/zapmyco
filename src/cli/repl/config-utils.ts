/**
 * Configuration file utilities
 *
 * Shared read/write helpers for ~/.zapmyco/settings.json,
 * used by settings-cmd.ts and session.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { HOME_CONFIG_PATH } from '@/config/loader';

/** Read settings.json and return a mutable object */
export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(HOME_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write back to settings.json */
export function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(HOME_CONFIG_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

/** Safely set a nested property (prototype-chain safe) */
export function _setByDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < keys.length - 1 ensures bounds
    const key = keys[i]!;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  // biome-ignore lint/style/noNonNullAssertion: split returns at least 1 element
  const lastKey = keys[keys.length - 1]!;
  if (lastKey === '__proto__' || lastKey === 'constructor' || lastKey === 'prototype') return;
  current[lastKey] = value;
}

/** Get a nested property value via dot-path */
export function _getByDotPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}
