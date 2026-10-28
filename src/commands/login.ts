import { openDb } from '../cache/db.ts';
import { log } from '../log.ts';
import { refreshChats, rememberSelf } from '../wa/fetcher.ts';
import { startClient } from '../wa/client.ts';

export async function loginCommand(): Promise<void> {
  const client = await startClient({ interactive: true });
  try {
    const db = openDb();
    rememberSelf(db, client);
    const n = await refreshChats(db, client);
    log(`Login OK. ${n} conversas no cache.`);
    process.stdout.write(`login ok; ${n} conversas\n`);
  } finally {
    await Promise.race([client.destroy().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
  }
}
