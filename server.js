// Day Board server: Hono for routing, node:sqlite for storage (built into Node 22.5+).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1"; // local only; set HOST=0.0.0.0 to expose on your network
const DB_PATH = process.env.DB_PATH || "data/board.db";
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tasks (
    id   TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    slot INTEGER,            -- 0..2 when in a focus slot, NULL when in the quick list
    pos  INTEGER NOT NULL    -- order within the quick list
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

const readBoard = () => {
  const day = db.prepare("SELECT value FROM meta WHERE key='day'").get()?.value ?? null;
  const rows = db.prepare("SELECT * FROM tasks ORDER BY pos").all();
  const items = {}, focus = [null, null, null], list = [];
  for (const r of rows) {
    items[r.id] = { t: r.text, d: !!r.done };
    if (r.slot !== null && r.slot >= 0 && r.slot < 3) focus[r.slot] = r.id;
    else list.push(r.id);
  }
  return { day, items, focus, list };
};

const writeBoard = (b) => {
  const ins = db.prepare("INSERT INTO tasks (id,text,done,slot,pos) VALUES (?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM tasks");
    b.focus.forEach((id, i) => { if (id && b.items[id]) ins.run(id, String(b.items[id].t).slice(0, 500), b.items[id].d ? 1 : 0, i, 0); });
    b.list.forEach((id, i) => { if (b.items[id]) ins.run(id, String(b.items[id].t).slice(0, 500), b.items[id].d ? 1 : 0, null, i); });
    db.prepare("INSERT INTO meta (key,value) VALUES ('day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(b.day));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
};

const app = new Hono();
app.get("/api/board", (c) => c.json(readBoard()));
app.put("/api/board", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.items !== "object" || !Array.isArray(b.focus) || !Array.isArray(b.list) || !b.day)
    return c.json({ error: "bad board" }, 400);
  writeBoard(b);
  return c.json({ ok: true });
});
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () =>
  console.log(`Day Board running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
