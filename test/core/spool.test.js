import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createEventIdentity,
  JsonlSpool,
  SensitiveContentError,
  SpoolError,
} from '../../src/core/index.js';

const KEY = 'synthetic-test-key-that-is-not-a-production-secret';
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function temporarySpool() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qoder-hook-spool-'));
  temporaryDirectories.push(directory);
  return { directory, spool: new JsonlSpool(directory) };
}

function syntheticEvent(sourceId = 'fixture-1') {
  const identity = createEventIdentity({ sourceId }, KEY);
  return {
    schema_version: '2.0',
    event_id: identity.event_id,
    source: { input_fingerprint: identity.source_fingerprint },
    event: 'tool_start',
    privacy: { content_stored: false },
  };
}

test('spool persists one JSONL event and deduplicates across instances', async () => {
  const { directory, spool } = await temporarySpool();
  const event = syntheticEvent();

  assert.deepEqual(await spool.append(event), { stored: true, duplicate: false });
  assert.deepEqual(
    await new JsonlSpool(directory).append({ ...event, event_id: 'a-different-retry-id' }),
    { stored: false, duplicate: true },
  );

  const eventsFile = await readFile(path.join(directory, 'events.jsonl'), 'utf8');
  const indexFile = await readFile(path.join(directory, 'idempotency.jsonl'), 'utf8');
  assert.equal(eventsFile.trim().split(/\r?\n/).length, 1);
  assert.equal(indexFile.trim().split(/\r?\n/).length, 1);
  assert.doesNotMatch(eventsFile, /SYNTHETIC_PROMPT_BODY/);
});

test('concurrent appends are serialized and preserve all unique events', async () => {
  const { directory, spool } = await temporarySpool();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) => spool.append(syntheticEvent(`fixture-${index}`))),
  );

  assert.equal(results.filter((result) => result.stored).length, 12);
  const lines = (await readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/);
  assert.equal(lines.length, 12);
  assert.doesNotThrow(() => lines.map(JSON.parse));
});

test('spool refuses a raw sensitive field before any file is written', async () => {
  const { directory, spool } = await temporarySpool();
  const event = { ...syntheticEvent(), output: 'SYNTHETIC_TOOL_OUTPUT' };

  await assert.rejects(() => spool.append(event), SensitiveContentError);
  await assert.rejects(() => readFile(path.join(directory, 'events.jsonl')), { code: 'ENOENT' });
});

test('lock timeout has explicit fail-open semantics', async () => {
  const { directory } = await temporarySpool();
  await mkdir(path.join(directory, '.append.lock'));
  const spool = new JsonlSpool(directory, { lockTimeoutMs: 5, retryDelayMs: 1 });

  await assert.rejects(
    () => spool.append(syntheticEvent()),
    (error) => error instanceof SpoolError
      && error.code === 'ERR_SPOOL_LOCK_TIMEOUT'
      && error.failOpen === true,
  );
});

test('invalid events are fail-open but not retryable', async () => {
  const { spool } = await temporarySpool();
  await assert.rejects(
    () => spool.append({ event: 'prompt_submit' }),
    (error) => error instanceof SpoolError
      && error.code === 'ERR_SPOOL_EVENT_INVALID'
      && error.failOpen === true
      && error.retryable === false,
  );
});
