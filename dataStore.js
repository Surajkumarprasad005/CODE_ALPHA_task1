import fs from 'node:fs/promises';
import path from 'node:path';

export function createDefaultDb() {
  return {
    users: [],
    projects: []
  };
}

export async function readDb(dbPath) {
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, JSON.stringify(createDefaultDb(), null, 2));
    return createDefaultDb();
  }
}

export async function writeDb(dbPath, db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}
