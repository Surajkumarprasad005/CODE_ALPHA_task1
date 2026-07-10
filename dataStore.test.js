import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createDefaultDb, readDb, writeDb } from '../dataStore.js';

test('reads and writes the database file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-tool-'));
  const dbPath = path.join(tempDir, 'db.json');

  const initial = await readDb(dbPath);
  assert.deepEqual(initial, createDefaultDb());

  const updated = createDefaultDb();
  updated.users.push({ id: '1', name: 'Alex', email: 'alex@example.com' });
  await writeDb(dbPath, updated);

  const persisted = await readDb(dbPath);
  assert.equal(persisted.users[0].email, 'alex@example.com');

  await fs.rm(tempDir, { recursive: true, force: true });
});
