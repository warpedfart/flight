Set-Location D:\flight-server
$env:AJ_PUBLIC_URL = "https://babyburrow.playit.plus"
$env:AJ_GAME_PORT = "14265"
$env:AJ_HOST = "babyburrow.duckdns.org"
$env:AJ_TRUSTED_PROXY = "1"
$env:AJ_TLS_CERT = "D:\lego\.lego\certificates\babyburrow.duckdns.org.crt"
$env:AJ_TLS_KEY = "D:\lego\.lego\certificates\babyburrow.duckdns.org.key"
$env:AJ_QUIET = "0"
node server.js