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
Stop it with Ctrl+C. By default it listens on this computer only, so nobody else can connect (to let friends in, see step 10).

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

## 10. Sharing your local server with friends
By default only your computer can connect (step 3). To let friends in from the internet you need to do three
things: make the server listen on the network, open the ports in your firewall and router, and give friends an
address to use. Only do this if you are comfortable with strangers' traffic reaching your computer; keep
**invite only** on (admin panel > Invites) so only people you give a code can sign up.

Ports used: **8080** (website and sign-up) and **9339** (the game). Both are TCP.

### 10a. Without a domain (your IP address)
1. **Find your public IP:** `curl -4 ifconfig.me`. Your **local** IP (for the router) is from `ip -4 addr` on Linux or
   `ipconfig` on Windows, usually `192.168.x.x`.
2. **Start the server listening on the network.** Using your public IP from step 1:
   ```sh
   AJ_BIND=0.0.0.0 AJ_PUBLIC_URL=http://YOUR_PUBLIC_IP:8080 npm start
   ```
   (fish: `env AJ_BIND=0.0.0.0 AJ_PUBLIC_URL=http://YOUR_PUBLIC_IP:8080 npm start`; PowerShell: set
   `$env:AJ_BIND="0.0.0.0"` and `$env:AJ_PUBLIC_URL="http://YOUR_PUBLIC_IP:8080"` first.)
   `AJ_PUBLIC_URL` is what tells the game client where to connect. Because the server is now public it
   refuses `AJ_REGISTER=1`, and the admin panel only answers on your own computer (use
   `http://127.0.0.1:8080/admin` as before).
3. **Allow the ports through your computer's firewall:**
   - Linux with ufw: `sudo ufw allow 8080/tcp && sudo ufw allow 9339/tcp`
   - Linux with firewalld (e.g. Fedora): `sudo firewall-cmd --add-port=8080/tcp --add-port=9339/tcp --permanent && sudo firewall-cmd --reload`
   - Windows (admin PowerShell): `New-NetFirewallRule -DisplayName "Flight" -Direction Inbound -Protocol TCP -LocalPort 8080,9339 -Action Allow`
   - If you have no firewall running, skip this.
4. **Forward the ports on your router.** In the router's admin page (often `192.168.0.1` or `192.168.1.1`), find
   "Port forwarding" / "Virtual server" and forward TCP **8080** and **9339** to your computer's local IP. Give
   your computer a fixed local IP (DHCP reservation) so the forward doesn't break.
5. **Test from outside your home network** (phone on mobile data, or a friend): open
   `http://YOUR_PUBLIC_IP:8080/`. Testing from your own network often fails even when it works for others.
6. **Tell friends** to register at `http://YOUR_PUBLIC_IP:8080/register` with an invite code, then enter
   `http://YOUR_PUBLIC_IP:8080` as the server in the client.

Limits of this option: most home connections get a **new public IP now and then**, so you must update
`AJ_PUBLIC_URL` and tell friends each time (the next option fixes this). The connection is plain HTTP, so
passwords are not encrypted in transit; use a throwaway password and don't reuse one. The client only connects to
an `http://` address like this if **Allow unencrypted** is switched on in its settings, so tell friends to turn
that on. If your ISP uses CGNAT
(your router's "WAN IP" differs from `curl ifconfig.me`), port forwarding can't work; use a VPS
([deploy/ORACLE.md](deploy/ORACLE.md)) or a tunnel/VPN tool instead.

### 10b. With a free DuckDNS name
DuckDNS gives you a name like `myflight.duckdns.org` that follows your changing home IP, so friends use one
address.
1. Sign in at <https://www.duckdns.org> and create a subdomain. Note your **token**.
2. Keep it pointed at your IP by running this regularly (every 5 minutes, via cron or a systemd timer; leaving the
   `ip=` empty makes DuckDNS use the address the request comes from):
   ```sh
   curl -s "https://www.duckdns.org/update?domains=myflight&token=YOUR_TOKEN&ip="
   ```
   It prints `OK` on success. Keep the token private.
3. Do steps 3 to 4 of 10a (firewall and router forwarding) unchanged.
4. Start the server with the name instead of the IP:
   ```sh
   AJ_BIND=0.0.0.0 AJ_PUBLIC_URL=http://myflight.duckdns.org:8080 npm start
   ```
5. Friends register at `http://myflight.duckdns.org:8080/register` and use that address in the client, with
   **Allow unencrypted** switched on in its settings (needed for any `http://` address).

If you want HTTPS instead of plain HTTP, you need a certificate for the DuckDNS name (certbot's DNS challenge
works with DuckDNS) and the `AJ_TLS_CERT` / `AJ_TLS_KEY` settings, with ports forwarded as above and an
`https://` public URL. [deploy/ORACLE.md](deploy/ORACLE.md) steps 5 and 7 show the certificate and settings on
a server.

### Stopping sharing
Stop the server (Ctrl+C), then remove the router port forwards and firewall rules (`sudo ufw delete allow
8080/tcp` and the same for 9339 on ufw). Back up `data/` before you share, so a bad actor or a mistake can't cost
you your own accounts.

## Troubleshooting
- **`node:sqlite` or "unexpected token" errors:** your Node is too old; install 22.5 or later.
- **Port already in use:** change `AJ_HTTP_PORT` / `AJ_GAME_PORT`, or stop the other program.
- **The client says it cannot connect:** make sure the server is running and the client's address is exactly
  `http://127.0.0.1:8080`, not `https` (there is no certificate locally).
- **The client says it is outdated or is refused at login:** only a Flight/Burrow-style client that sends device
  IDs is accepted. For quick local experiments you can start the server with `AJ_REQUIRE_DEVICE=0`.
- **Pages or art look empty on first run:** the first visit fetches files into `cache/`; wait a moment and reload.
