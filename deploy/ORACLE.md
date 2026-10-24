# Running Flight on Oracle Cloud (Always Free)

Placeholders: `flight.example.com` = your domain, `YOUR_IP` = your home IP, `VM_IP` = the VM's public IP.
Assumes Ubuntu 24.04. Commands are run on the VM unless marked **[local]**.

## 0. Before you start
- A domain (or subdomain) you can edit DNS for. Free `duckdns.org` names work.
- An Oracle Cloud account (needs a card for verification; Always Free resources are not billed).
- An SSH key: **[local]** `ssh-keygen -t ed25519` if you don't have one; you'll paste `~/.ssh/id_ed25519.pub`.
- Your Git repo URL (`https://github.com/butterbarned/babyburt`). If it is private, use a deploy key or a token.

## 0b. Reusing a VM you already have
If the VM already runs something else (for example a Caddy-fronted site), skip step 1 and read this first.
- **Do not delete an Ampere A1 VM to start over.** Free A1 capacity is often unavailable, so you may not get it back.
- Move anything else off the VM first and confirm it works elsewhere. If Caddy owns ports 80/443, stop and disable it
  (`sudo systemctl disable --now caddy`) before step 5, because certbot standalone and Flight both need those ports.
- Ports 80 and 443 may already be open in both firewalls; add only 9339 (step 3) and avoid duplicate rules.
- Free disk space and RAM are shared: check `df -h` and `free -h`.
- Anything else that serves the same hostname must be turned off before Flight starts, or the bind on 443 fails.

## 1. Create the VM
1. Console > Compute > Instances > **Create instance**.
2. Image: **Canonical Ubuntu 24.04**.
3. Shape: **Ampere `VM.Standard.A1.Flex`**, 2 OCPU / 12 GB (Always Free allows up to 4 / 24). If you get "out of capacity", retry later or try another availability domain, or use `VM.Standard.E2.1.Micro` (1 GB RAM: add swap, see step 3).
4. Networking: keep the default VCN and **assign a public IPv4**.
5. Paste your SSH public key. Boot volume: 50 GB is fine.
6. Create, wait for "Running", copy the public IP.
7. **[local]** `ssh ubuntu@VM_IP`. (Optional: Networking > IP management > Reserved public IPs, so the IP survives re-creating the VM.)

## 2. DNS
Add an `A` record: `flight.example.com` -> `VM_IP`. Check with `dig +short flight.example.com` before step 5.

## 3. Open the ports (Oracle needs two layers)
**Cloud firewall.** Networking > Virtual cloud networks > your VCN > Security Lists > Default > **Add ingress rules**, one each, source `0.0.0.0/0`, protocol TCP, destination port: `80`, `443`, `9339`.

**VM firewall.** Oracle's Ubuntu image ships iptables rules that block everything but SSH:
```sh
sudo iptables -I INPUT 5 -p tcp -m multiport --dports 80,443,9339 -j ACCEPT
sudo apt update && sudo apt install -y iptables-persistent   # say yes to saving
sudo netfilter-persistent save
```
Optional swap for small shapes:
```sh
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Install Node, git, certbot
```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git certbot acl
node -v        # must be >= 22.5
```

## 5. TLS certificate
Port 80 must be free and open (step 3).
```sh
sudo certbot certonly --standalone -d flight.example.com
```
Let the server's user read the certs (created in step 6):
```sh
sudo useradd -m -s /bin/bash flight
sudo setfacl -R -m u:flight:rX /etc/letsencrypt/live /etc/letsencrypt/archive
```
Restart on renewal:
```sh
echo 'renew_hook = systemctl restart flight' | sudo tee -a /etc/letsencrypt/renewal/flight.example.com.conf
sudo certbot renew --dry-run
```
(New renewed files stay readable because the ACL on `archive` is inherited via a default ACL: also run
`sudo setfacl -R -d -m u:flight:rX /etc/letsencrypt/archive`.)

## 6. Install the server
```sh
sudo -u flight git clone https://github.com/butterbarned/babyburt /home/flight/flight
cd /home/flight/flight
sudo -u flight npm ci --omit=dev     # installs discord.js (only needed for the Discord bot)
```
`swf/` and `public/` come with the repo. Other game files are fetched on demand from the upstream CDN and cached in `cache/` (so the first players load slowly). Don't set `AJ_OFFLINE=1` unless you have copied a full cache over.

## 7. Configure and run as a service
Put secrets/optional settings in an env file, readable only by root and the service:
```sh
sudo install -m 600 -o flight /dev/null /etc/flight.env
sudoedit /etc/flight.env
```
Contents (all optional unless noted):
```
# Needed for the public Terms/Privacy pages:
AJ_OPERATOR=your name or organisation
AJ_HOSTED_IN=United States
AJ_LEGAL_EMAIL=legal@example.com
AJ_ADMIN_EMAIL=admin@example.com
# Strongly recommended: stops bots registering
# AJ_TURNSTILE_SITE_KEY=...
# AJ_TURNSTILE_SECRET=...
# Discord bot, if you use it:
# AJ_DISCORD_BOT_TOKEN=...
# AJ_DISCORD_GUILD_ID=...
```
Service file `/etc/systemd/system/flight.service`:
```ini
[Unit]
Description=Flight server
After=network-online.target
Wants=network-online.target

[Service]
User=flight
WorkingDirectory=/home/flight/flight
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
EnvironmentFile=/etc/flight.env
Environment=AJ_PUBLIC_URL=https://flight.example.com
Environment=AJ_BIND=0.0.0.0
Environment=AJ_HTTP_PORT=443
Environment=AJ_GAME_PORT=9339
Environment=AJ_TLS_CERT=/etc/letsencrypt/live/flight.example.com/fullchain.pem
Environment=AJ_TLS_KEY=/etc/letsencrypt/live/flight.example.com/privkey.pem

[Install]
WantedBy=multi-user.target
```
```sh
sudo systemctl daemon-reload
sudo systemctl enable --now flight
journalctl -u flight -f      # look for "[server] ready"
```
Do **not** set `AJ_TRUSTED_PROXY` (no proxy here), `AJ_TRUST_LOCAL` or `AJ_REGISTER=1`; the server refuses to start with those on a public address.

## 8. First-time setup (the admin panel is localhost-only)
On a public server `/admin` only answers requests coming from the VM itself (or addresses in `AJ_ADMIN_ALLOW`). Use an SSH tunnel:
```sh
# [local]
ssh -L 8443:localhost:443 ubuntu@VM_IP
```
then open `https://localhost:8443/admin` (accept the certificate-name warning: the cert is for your domain). Alternatively add `AJ_ADMIN_ALLOW=YOUR_IP` to `/etc/flight.env` and restart; only do that with a fixed IP.

1. Enter the setup code from `journalctl -u flight | grep setup` if asked, and choose the admin password.
2. Make an account (or sign up at `https://flight.example.com/register`) and promote it to staff in the panel.
3. Open the **Invites** page, switch on **invite only**, and make codes. Do this before announcing the server.
4. Visit `https://flight.example.com/` and `/register` to check the site works with HTTPS.

## 9. Connect a game client
The game client (launcher) must point at `https://flight.example.com` with game port `9339`. The server turns away clients that don't send device IDs (`AJ_REQUIRE_DEVICE`), so use your own Flight launcher build rather than an old or official one. Set `AJ_DOWNLOAD_URL` in `/etc/flight.env` to show a download link on the home page.

## 10. Updates
Manual:
```sh
cd /home/flight/flight && sudo -u flight git pull --ff-only && sudo -u flight npm ci --omit=dev && sudo systemctl restart flight
```
Automatic (checks every 2 minutes; your branch is `master`, the script defaults to `main`):
```sh
sudo cp deploy/flight-update.{service,timer} /etc/systemd/system/
sudo sed -i 's#/home/aj/ajc-private-server#/home/flight/flight#' /etc/systemd/system/flight-update.service
sudo mkdir -p /etc/systemd/system/flight-update.service.d
printf '[Service]\nEnvironment=FLIGHT_DIR=/home/flight/flight FLIGHT_USER=flight FLIGHT_BRANCH=master FLIGHT_INIT=systemd\n' | sudo tee /etc/systemd/system/flight-update.service.d/env.conf
sudo systemctl daemon-reload && sudo systemctl enable --now flight-update.timer
```

## 11. Backups (do this early)
All player data is in `/home/flight/flight/data/` (`game.sqlite`, daily copies in `backups/`, logs). It is gitignored; never commit it. Pull it to your computer regularly:
```sh
# [local]
rsync -az ubuntu@VM_IP:/home/flight/flight/data/ ~/flight-backup/
```
(`sudo chmod -R a+rX` or run rsync with `--rsync-path="sudo rsync"` if permissions block it.) Also consider an Oracle boot-volume backup.

## Troubleshooting
- **Site unreachable:** both firewall layers (step 3); `sudo ss -tlnp | grep -E '443|9339'`.
- **Service won't start:** `journalctl -u flight -e`. A message about contradicting settings names the env var.
- **"permission denied" on cert:** re-run the `setfacl` commands in step 5.
- **Port 443 bind error:** check `AmbientCapabilities` is in the unit file.
- **Certbot fails:** DNS not propagated yet, or port 80 closed.
