// Safe online backup of the SQLite database (works while the server is running).
// Usage: DB_PATH=data/board.db BACKUP_DIR=backups KEEP_DAYS=14 node backup.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = process.env.DB_PATH || "data/board.db";
const dir = process.env.BACKUP_DIR || "backups";
const keepMs = Number(process.env.KEEP_DAYS || 14) * 86400000;

mkdirSync(dir, { recursive: true });
const dest = join(dir, `board-${new Date().toISOString().slice(0, 10)}.db`);
if (existsSync(dest)) unlinkSync(dest); // VACUUM INTO refuses to overwrite
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log("backup written:", dest);

for (const f of readdirSync(dir)) {
  if (!/^board-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
  const p = join(dir, f);
  if (Date.now() - statSync(p).mtimeMs > keepMs) { unlinkSync(p); console.log("pruned:", p); }
}
