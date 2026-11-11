#!/usr/bin/env node
// Day Board CLI. Talks to the same HTTP API as the web page.
// BOARD_URL defaults to http://127.0.0.1:3000 (set it to your server, e.g. http://192.168.178.121:3000).

const BASE = (process.env.BOARD_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(2, s), bold = (s) => c(1, s), green = (s) => c(32, s);

const HELP = `Usage: board [command] [args]

  board                     show today's board (same as: board status)
  board status [--json]     show the board; --json prints raw data
  board add <text>          add to the top of the quick list
  board focus <text>        add a new item straight into the first free focus slot
  board focus <ref>         move an existing item into the first free focus slot
  board delegate <name> <text>   hand an item to someone (shown under "Waiting on others")
  board unfocus <ref>       move a focus item back to the top of the list
  board done <ref...>       mark done
  board undo <ref...>       mark not done
  board rm <ref...>         delete
  board clear               delete all done items from the list

Refs: f1 f2 f3 are the focus slots; 1, 2, 3... are positions in the quick list; w1, w2... are items waiting on others.
Set BOARD_URL to point at your server (default ${BASE}).`;

const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const uid = () => Math.random().toString(36).slice(2, 9);
const fail = (m) => { console.error(m); process.exit(1); };

async function load() {
  let b;
  try {
    const r = await fetch(`${BASE}/api/board`);
    if (!r.ok) fail(`Server returned HTTP ${r.status}`);
    b = await r.json();
  } catch (e) { fail(`Cannot reach ${BASE} (${e.cause?.code || e.message}). Set BOARD_URL?`); }
  b.waiting ||= []; b.people ||= [];
  let changed = false;
  if (!b.day) { b.day = today(); changed = true; }
  else if (b.day !== today()) { // same new-day rule as the web page
    const back = b.focus.filter((id) => id && !b.items[id].d);
    b.focus = [null, null, null];
    b.list = back.concat(b.list);
    for (const id of Object.keys(b.items)) if (b.items[id].d) delete b.items[id];
    b.list = b.list.filter((id) => b.items[id]);
    b.waiting = b.waiting.filter((id) => b.items[id]);
    b.day = today(); changed = true;
  }
  return { b, changed };
}

async function save(b) {
  const r = await fetch(`${BASE}/api/board`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  if (!r.ok) fail(`Save failed: HTTP ${r.status} ${await r.text()}`);
}

function resolve(b, ref) {
  const m = /^f([1-3])$/i.exec(ref);
  if (m) { const id = b.focus[m[1] - 1]; if (!id) fail(`Focus slot ${ref} is empty.`); return id; }
  const w = /^w(\d+)$/i.exec(ref);
  if (w) { const id = b.waiting[Number(w[1]) - 1]; if (!id) fail(`No waiting item ${ref}.`); return id; }
  if (/^\d+$/.test(ref)) { const id = b.list[Number(ref) - 1]; if (!id) fail(`No list item ${ref}.`); return id; }
  return fail(`Bad ref "${ref}". Use f1-f3, w1.., or a list number.`);
}
const isRef = (s) => /^(f\d+|w\d+|\d+)$/i.test(s); // f4 etc. count as refs so typos error instead of becoming tasks
const remove = (b, id) => { b.focus = b.focus.map((x) => (x === id ? null : x)); b.list = b.list.filter((x) => x !== id); b.waiting = b.waiting.filter((x) => x !== id); };

function show(b) {
  const box = (id) => (b.items[id].d ? green("[x]") : "[ ]");
  const txt = (id) => (b.items[id].d ? dim(b.items[id].t) : b.items[id].t);
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const open = b.list.filter((id) => !b.items[id].d).length;
  console.log(`${bold(date)}\n`);
  console.log(bold("Focus"));
  b.focus.forEach((id, i) => console.log(`  ${dim("f" + (i + 1))}  ${id ? `${box(id)} ${txt(id)}` : dim("(empty)")}`));
  console.log(`\n${bold(`Quick list`)} ${dim(`(${open} open)`)}`);
  if (!b.list.length) console.log(dim("  (nothing here)"));
  b.list.forEach((id, i) => console.log(`  ${dim(String(i + 1).padStart(2))}  ${box(id)} ${txt(id)}`));
  const wopen = b.waiting.filter((id) => !b.items[id].d).length;
  console.log(`\n${bold("Waiting on others")} ${dim(`(${wopen} open)`)}`);
  if (!b.waiting.length) console.log(dim("  (nothing handed off)"));
  b.waiting.forEach((id, i) => console.log(`  ${dim("w" + (i + 1))}  ${box(id)} ${txt(id)} ${dim("· " + b.items[id].w)}`));
}

const [cmd = "status", ...args] = process.argv.slice(2);
const { b, changed } = await load();
let dirty = changed;

switch (cmd) {
  case "status": case "ls": case "list":
    if (args.includes("--json")) console.log(JSON.stringify(b, null, 2)); else show(b);
    break;
  case "add": {
    const t = args.join(" ").trim(); if (!t) fail("add what?");
    const id = uid(); b.items[id] = { t, d: false }; b.list.unshift(id); dirty = true; show(b); break;
  }
  case "focus": {
    const slot = b.focus.indexOf(null); if (slot < 0) fail("All three focus slots are full.");
    if (args.length === 1 && isRef(args[0])) {
      const id = resolve(b, args[0]);
      if (b.focus.includes(id)) fail("That item is already in focus.");
      remove(b, id); b.focus[slot] = id;
    } else {
      const t = args.join(" ").trim(); if (!t) fail("focus on what?");
      const id = uid(); b.items[id] = { t, d: false }; b.focus[slot] = id;
    }
    dirty = true; show(b); break;
  }
  case "delegate": case "give": {
    let who = args[0], t = args.slice(1).join(" ").trim();
    if (!who || !t) fail('Usage: board delegate <name> <text>   (quote multi-word names: board delegate "Sam Lee" call back)');
    who = b.people.find((n) => n.toLowerCase() === who.toLowerCase()) || who;
    if (!b.people.includes(who)) b.people.push(who);
    const id = uid(); b.items[id] = { t, d: false, w: who }; b.waiting.unshift(id); dirty = true; show(b); break;
  }
  case "unfocus": {
    if (!args.length) fail("unfocus which slot? (f1-f3)");
    const id = resolve(b, args[0]); if (!b.focus.includes(id)) fail("That item is not in a focus slot.");
    remove(b, id); b.list.unshift(id); dirty = true; show(b); break;
  }
  case "done": case "undo": {
    if (!args.length) fail(`${cmd} which item?`);
    for (const id of args.map((r) => resolve(b, r))) b.items[id].d = cmd === "done";
    dirty = true; show(b); break;
  }
  case "rm": case "delete": {
    if (!args.length) fail("rm which item?");
    for (const id of args.map((r) => resolve(b, r))) { remove(b, id); delete b.items[id]; }
    dirty = true; show(b); break;
  }
  case "clear": {
    for (const id of b.list.filter((id) => b.items[id].d)) { remove(b, id); delete b.items[id]; }
    dirty = true; show(b); break;
  }
  case "help": case "-h": case "--help": console.log(HELP); break;
  default: console.error(`Unknown command "${cmd}".\n`); console.error(HELP); process.exit(1);
}
if (dirty) await save(b);
