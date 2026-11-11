# Day Board

A small todo tracker: three focus slots for today, a quick-capture list underneath, drag and drop between them. Hono server, SQLite storage (Node's built-in `node:sqlite`), plain HTML/JS front end.

On the first load of each new day, ticked-off cards are cleared and unfinished focus cards move to the top of the quick list.

## Run locally

Needs Node 22.13 or newer.

```
npm install
npm start
```

Open http://127.0.0.1:3000. Data is stored in `data/board.db`.

| Variable  | Default          | Purpose                                      |
|-----------|------------------|----------------------------------------------|
| `PORT`    | `3000`           | Port to listen on                            |
| `HOST`    | `127.0.0.1`      | Bind address. `0.0.0.0` exposes it on the network |
| `DB_PATH` | `data/board.db`  | SQLite file location                         |

There is no login. Keep it on localhost, or put it behind a reverse proxy that handles authentication.

## Deploy with Docker

```
docker compose up -d --build
```

It listens on `127.0.0.1:3000` only; put your reverse proxy in front. The database lives in the `board-data` volume.

## Deploy with systemd

```
rsync -a --exclude node_modules --exclude data ./ server:/opt/day-board/
ssh server 'cd /opt/day-board && npm ci --omit=dev'
```

Create a `dayboard` user, make `/opt/day-board/data` writable by it, then install `deploy/day-board.service` into `/etc/systemd/system/` and run `systemctl enable --now day-board`.

## Reverse proxy with a login (Caddy)

```
board.internal.example {
    basicauth {
        luke <hash from `caddy hash-password`>
    }
    reverse_proxy 127.0.0.1:3000
}
```

## Backups

`backup.mjs` makes a consistent copy of the database while the server is running and deletes copies older than `KEEP_DAYS` (default 14).

- systemd: copy `deploy/day-board-backup.cron` to `/etc/cron.d/day-board-backup`. It writes to `/var/backups/day-board`.
- Docker: add `30 2 * * * cd /opt/day-board && docker compose exec -T day-board node backup.mjs` to the host's crontab. Backups appear in `./backups`.

To restore, stop the server and replace `board.db` with a backup file (delete any `board.db-wal` and `board.db-shm` next to it).

## API

- `GET /api/board` returns `{day, items, focus, list}`.
- `PUT /api/board` replaces the whole board. The last write wins.
