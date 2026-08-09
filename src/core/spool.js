import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { stableCanonicalize } from './crypto.js';
import { assertNoRawSensitiveContent } from './privacy.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class SpoolError extends Error {
  constructor(message, code, cause, { retryable = true } = {}) {
    super(message, { cause });
    this.name = 'SpoolError';
    this.code = code;
    this.failOpen = true;
    this.retryable = retryable;
  }
}

async function readJsonLines(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch (cause) {
      throw new SpoolError(
        `Invalid JSONL record in ${filePath} at line ${index + 1}`,
        'ERR_SPOOL_CORRUPT',
        cause,
      );
    }
  }
  return records;
}

async function durableAppend(filePath, record) {
  const handle = await open(filePath, 'a');
  try {
    await handle.writeFile(`${stableCanonicalize(record)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class JsonlSpool {
  constructor(directory, options = {}) {
    if (typeof directory !== 'string' || directory.trim() === '') {
      throw new TypeError('A spool directory is required');
    }

    this.directory = path.resolve(directory);
    this.eventsPath = path.join(this.directory, options.eventsFile ?? 'events.jsonl');
    this.indexPath = path.join(this.directory, options.indexFile ?? 'idempotency.jsonl');
    this.lockPath = path.join(this.directory, '.append.lock');
    this.lockTimeoutMs = options.lockTimeoutMs ?? 50;
    this.staleLockMs = options.staleLockMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 2;
    this.tail = Promise.resolve();
  }

  append(event) {
    const operation = this.tail
      .catch(() => undefined)
      .then(() => this.#appendLocked(event));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async #appendLocked(event) {
    let release;
    try {
      assertNoRawSensitiveContent(event);
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new SpoolError(
          'Spool events must be objects',
          'ERR_SPOOL_EVENT_INVALID',
          undefined,
          { retryable: false },
        );
      }

      const fingerprint = event.source?.input_fingerprint ?? event.source_fingerprint;
      if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        throw new SpoolError(
          'event.source.input_fingerprint must be a lowercase HMAC-SHA256 hex value',
          'ERR_SPOOL_EVENT_INVALID',
          undefined,
          { retryable: false },
        );
      }

      await mkdir(this.directory, { recursive: true });
      release = await this.#acquireLock();

      const [events, indexRecords] = await Promise.all([
        readJsonLines(this.eventsPath),
        readJsonLines(this.indexPath),
      ]);
      const indexed = new Set(indexRecords.map((record) => (
        record.input_fingerprint ?? record.source_fingerprint
      )));

      for (const persisted of events) {
        const persistedFingerprint = persisted.source?.input_fingerprint
          ?? persisted.source_fingerprint;
        if (typeof persistedFingerprint !== 'string') {
          throw new SpoolError(
            `Event without source.input_fingerprint in ${this.eventsPath}`,
            'ERR_SPOOL_CORRUPT',
          );
        }
        if (!indexed.has(persistedFingerprint)) {
          await durableAppend(this.indexPath, {
            input_fingerprint: persistedFingerprint,
            event_id: persisted.event_id ?? null,
          });
          indexed.add(persistedFingerprint);
        }
      }

      if (indexed.has(fingerprint)) {
        return { stored: false, duplicate: true };
      }

      const persistedEvent = {
        ...event,
        event_id: typeof event.event_id === 'string' && event.event_id !== ''
          ? event.event_id
          : randomUUID(),
      };
      await durableAppend(this.eventsPath, persistedEvent);
      await durableAppend(this.indexPath, {
        input_fingerprint: fingerprint,
        event_id: persistedEvent.event_id,
      });
      return { stored: true, duplicate: false };
    } catch (error) {
      if (error instanceof SpoolError || error?.failOpen === true) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new SpoolError(
          'Event cannot be serialized safely',
          'ERR_SPOOL_EVENT_INVALID',
          error,
          { retryable: false },
        );
      }
      throw new SpoolError('Unable to append to the local event spool', 'ERR_SPOOL_WRITE', error);
    } finally {
      await release?.();
    }
  }

  async #acquireLock() {
    const deadline = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        await mkdir(this.lockPath);
        return async () => {
          try {
            await rm(this.lockPath, { recursive: true, force: true });
          } catch {
            // A stale-lock contender may already have removed it.
          }
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;

        try {
          const lockStats = await stat(this.lockPath);
          if (Date.now() - lockStats.mtimeMs > this.staleLockMs) {
            await rm(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if (statError.code === 'ENOENT') continue;
          throw statError;
        }

        if (Date.now() >= deadline) {
          throw new SpoolError(
            `Timed out acquiring spool lock after ${this.lockTimeoutMs} ms`,
            'ERR_SPOOL_LOCK_TIMEOUT',
          );
        }
        await delay(this.retryDelayMs);
      }
    }
  }
}
