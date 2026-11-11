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
  CREATE TABLE IF NOT EXISTS people (name TEXT PRIMARY KEY COLLATE NOCASE); -- names offered as autocomplete
`);
// Older databases: add the column that marks an item as handed to someone.
if (!db.prepare("PRAGMA table_info(tasks)").all().some((c) => c.name === "who"))
  db.exec("ALTER TABLE tasks ADD COLUMN who TEXT");

const readBoard = () => {
  const day = db.prepare("SELECT value FROM meta WHERE key='day'").get()?.value ?? null;
  const rows = db.prepare("SELECT * FROM tasks ORDER BY pos").all();
  const items = {}, focus = [null, null, null], list = [], waiting = [];
  for (const r of rows) {
    items[r.id] = { t: r.text, d: !!r.done };
    if (r.who) { items[r.id].w = r.who; waiting.push(r.id); }
    else if (r.slot !== null && r.slot >= 0 && r.slot < 3) focus[r.slot] = r.id;
    else list.push(r.id);
  }
  const people = db.prepare("SELECT name FROM people ORDER BY name COLLATE NOCASE").all().map((r) => r.name);
  return { day, items, focus, list, waiting, people };
};

const clean = (v, n) => String(v).trim().slice(0, n);

const writeBoard = (b) => {
  const ins = db.prepare("INSERT INTO tasks (id,text,done,slot,pos,who) VALUES (?,?,?,?,?,?)");
  const addPerson = db.prepare("INSERT OR IGNORE INTO people (name) VALUES (?)");
  const row = (id, slot, pos, who) => ins.run(id, clean(b.items[id].t, 500), b.items[id].d ? 1 : 0, slot, pos, who);
  db.exec("BEGIN");
  try {
    if (Array.isArray(b.waiting)) db.exec("DELETE FROM tasks");
    else db.exec("DELETE FROM tasks WHERE who IS NULL"); // an older page that doesn't know about waiting items must not wipe them
    b.focus.forEach((id, i) => { if (id && b.items[id]) row(id, i, 0, null); });
    b.list.forEach((id, i) => { if (b.items[id]) row(id, null, i, null); });
    (b.waiting || []).forEach((id, i) => {
      const who = b.items[id] && b.items[id].w ? clean(b.items[id].w, 80) : "";
      if (who) { row(id, null, i, who); addPerson.run(who); }
    });
    (Array.isArray(b.people) ? b.people : []).slice(0, 500).forEach((n) => { const v = clean(n, 80); if (v) addPerson.run(v); });
    db.prepare("INSERT INTO meta (key,value) VALUES ('day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(b.day));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
};

const app = new Hono();
app.get("/api/board", (c) => c.json(readBoard()));
app.put("/api/board", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.items !== "object" || !Array.isArray(b.focus) || !Array.isArray(b.list) || !b.day)
    { console.error("rejected board:", JSON.stringify(b)?.slice(0, 300)); return c.json({ error: "bad board" }, 400); }
  try { writeBoard(b); } catch (e) { console.error("write failed:", e.message); return c.json({ error: e.message }, 500); }
  return c.json({ ok: true });
});
app.delete("/api/people/:name", (c) => {
  db.prepare("DELETE FROM people WHERE name = ?").run(c.req.param("name"));
  return c.json({ ok: true });
});
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () =>
  console.log(`Day Board running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
