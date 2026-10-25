// The plugin's own version, from its manifest (read only). Shared by `record` and the dashboard.
import { readFileSync } from 'node:fs';
import { pluginManifestFile } from './paths.ts';

export function pluginVersion(): string | null {
  try { return String((JSON.parse(readFileSync(pluginManifestFile(), 'utf8')) as { version?: unknown }).version ?? '') || null; } catch { return null; }
}
