# Running Flight on your own computer

This sets up a private test server that only your machine can reach. For a public server, use
[deploy/ORACLE.md](deploy/ORACLE.md) instead.

## 1. Requirements
- **Node.js 22.5 or newer** (`node -v`). Older versions lack the built-in SQLite the server uses.
- **Git**.
- Internet access on first run: game files that are not in the repository are fetched once from the game's
  public content server and cached in `cache/`.
- The desktop client (a separate project) to actually play. The website and admin panel work without it.

## 2. Get the code and install
```sh
git clone https://github.com/butterbarned/babyburt flight
cd flight
npm ci
```
`npm ci` installs one dependency (`discord.js`), used only by the optional Discord bot. The game does not need it.

## 3. Start it
```sh
npm start
```
The log should end with lines like:
```
[http] listening on 127.0.0.1:8080
[game] listening on 127.0.0.1:9339
[server] ready at http://127.0.0.1:8080/
```
Stop it with Ctrl+C. By default it listens on this computer only, so nobody else can connect.

## 4. Set the admin password
1. Open <http://127.0.0.1:8080/admin>.
2. Choose an admin password. (From this machine no setup code is asked for. If you are asked, it is printed in
   the log on the line starting `[admin]`.)
3. The dashboard is at <http://127.0.0.1:8080/dashboard>.

## 5. Make an account
Either:
- Go to <http://127.0.0.1:8080/register> and sign up. If you turned invite-only on in the admin panel, make a code
  on the Invites page first. **or**
- Start the server with `AJ_REGISTER=1 npm start`. Then any unknown name that tries to log in from the game is
  created on the spot. This is only allowed on a local server; the server refuses it if it is public.

(`AJ_REGISTER=1` on fish shell: `env AJ_REGISTER=1 npm start`. On Windows PowerShell: `$env:AJ_REGISTER="1"; npm start`.)

## 6. Play with the desktop client
Start the client pointing at your server:
```sh
AJ_SERVER=http://127.0.0.1:8080 ./run.sh        # from the client folder
```
or run it normally and type `http://127.0.0.1:8080` in the server box on its start screen. The address defaults to
`http://127.0.0.1:8080`, so a plain `./run.sh` already points at a local server. Log in with the account from
step 5.

## 7. Useful settings for local use
Set these in the shell before `npm start`:

| Variable | Use |
|---|---|
| `AJ_HTTP_PORT=8081`, `AJ_GAME_PORT=9340` | Change ports if the defaults are taken. |
| `AJ_DATA_DIR=/path/to/data` | Keep the database somewhere else (handy for throwaway tests). |
| `AJ_OFFLINE=1` | Serve only from the local cache; never fetch from the internet. |
| `AJ_QUIET=1` | Less logging. (Packet logging is on by default locally.) |

## 8. Where things are saved
Everything the server writes goes under `data/` (the SQLite database `game.sqlite`, daily `backups/`, logs).
Delete `data/` to start again from scratch. It is not tracked by Git and must never be committed.

## 9. Run the tests
```sh
npm test
node .github/scripts/invariants.js
```
The tests start their own server on separate ports with a temporary data folder, so they do not touch your
`data/`.

## Troubleshooting
- **`node:sqlite` or "unexpected token" errors:** your Node is too old; install 22.5 or later.
- **Port already in use:** change `AJ_HTTP_PORT` / `AJ_GAME_PORT`, or stop the other program.
- **The client says it cannot connect:** make sure the server is running and the client's address is exactly
  `http://127.0.0.1:8080`, not `https` (there is no certificate locally).
- **The client says it is outdated or is refused at login:** only a Flight/Burrow-style client that sends device
  IDs is accepted. For quick local experiments you can start the server with `AJ_REQUIRE_DEVICE=0`.
- **Pages or art look empty on first run:** the first visit fetches files into `cache/`; wait a moment and reload.
