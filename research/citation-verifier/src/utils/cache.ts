import { mkdir, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { CONFIG } from '../config.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class DiskCache<T> {
  constructor(
    private cacheDir: string = CONFIG.cacheDir,
    private ttlMs: number = 24 * 60 * 60 * 1000, // 24 hours
  ) {}

  async get(key: string): Promise<T | null> {
    const filepath = join(this.cacheDir, `${this.hash(key)}.json`);
    try {
      const stats = await stat(filepath);
      if (Date.now() - stats.mtimeMs > this.ttlMs) return null;
      const content = await readFile(filepath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);
      return entry.data;
    } catch {
      return null;
    }
  }

  async set(key: string, data: T): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const filepath = join(this.cacheDir, `${this.hash(key)}.json`);
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await writeFile(filepath, JSON.stringify(entry));
  }

  private hash(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 32);
  }
}
