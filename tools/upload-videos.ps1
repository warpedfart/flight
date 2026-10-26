# uploads every video in a folder on this computer to the theatre's folder
# on the VPS (data/theatre-videos, see lib/theatrevideos.js), where staff can
# play them at once: no restart. it goes through PuTTY (pscp and plink) and
# a saved PuTTY session that logs in with a key.
#
#   powershell -ExecutionPolicy Bypass -File tools\upload-videos.ps1 -Folder "D:\Movies" -Session my-vps
#
# -Recurse takes the videos in the folder's folders too, all into the one
# theatre folder. -Server is where the server's repository is on the VPS
# (default /home/flight/flight).
#
# each video is uploaded to ~/theatre-incoming on the VPS, then
# tools/install-theatre-videos.sh (run there with sudo) moves them all in,
# owned by the server's user. a video already there (the same name and
# size) is not uploaded again, nor one already in ~/theatre-incoming from a
# run that was cut short, so it can be run again after a dropped connection.
# only .mp4, .m4v and .webm files are taken; a video's name is its file's.

param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][string]$Session,
  [string]$Server = "/home/flight/flight",
  [switch]$Recurse
)
$ErrorActionPreference = "Stop"
# the VPS answers in UTF-8: names with accents read back as they are
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Find-Tool($name) {
  $found = Get-Command "$name.exe" -ErrorAction SilentlyContinue
  if ($found) {
    return $found.Source
  }
  foreach ($dir in @("$env:ProgramFiles\PuTTY", "${env:ProgramFiles(x86)}\PuTTY")) {
    if ($dir -and (Test-Path -LiteralPath "$dir\$name.exe")) {
      return "$dir\$name.exe"
    }
  }
  throw "$name.exe was not found. It comes with PuTTY's full installer."
}

# the same as cleanName in lib/theatrevideos.js
function Get-CleanName($text) {
  $name = (($text -replace '[\x00-\x1f\x7f%/\\:*?"<>|]', '') -replace '\s+', ' ').Trim()
  if ($name.Length -gt 60) {
    $name = $name.Substring(0, 60).Trim()
  }
  return $name
}

# "<file name><tab><bytes>" lines from the VPS -> @{name = bytes}
function Read-Listing($lines) {
  $sizes = @{}
  foreach ($line in @($lines)) {
    $parts = "$line".Split("`t")
    if ($parts.Count -eq 2) {
      $sizes[$parts[0]] = [int64]$parts[1]
    }
  }
  return $sizes
}

$pscp = Find-Tool "pscp"
$plink = Find-Tool "plink"
if (-not (Test-Path -LiteralPath $Folder -PathType Container)) {
  throw "No such folder: $Folder"
}

$files = @(Get-ChildItem -LiteralPath $Folder -File -Recurse:$Recurse | Where-Object { @(".mp4", ".m4v", ".webm") -contains $_.Extension.ToLower() })
if ($files.Count -eq 0) {
  Write-Host "No .mp4, .m4v or .webm files in $Folder"
  exit 1
}

Write-Host "Asking the VPS what it has already..."
$installed = Read-Listing (& $plink -batch -load $Session "sudo bash '$Server/tools/install-theatre-videos.sh' --list")
if ($LASTEXITCODE -ne 0) {
  throw "plink could not run the install script on the VPS. Is the server's repository at $Server and up to date (git pull)?"
}
$waiting = Read-Listing (& $plink -batch -load $Session "mkdir -p ~/theatre-incoming && find ~/theatre-incoming -maxdepth 1 -type f -printf '%f\t%s\n'")

$chosen = @{}
$toSend = @()
foreach ($file in $files) {
  $name = Get-CleanName $file.BaseName
  $remote = "$name$($file.Extension.ToLower())"
  if (-not $name) {
    Write-Host "skipped, no usable name: $($file.FullName)"
  }
  elseif ($chosen.ContainsKey($remote)) {
    Write-Host "skipped, another file here is also called `"$name`": $($file.FullName)"
  }
  elseif ($installed.ContainsKey($remote) -and $installed[$remote] -eq $file.Length) {
    Write-Host "already on the VPS: $name"
  }
  elseif ($installed.ContainsKey($remote)) {
    Write-Host "skipped, the VPS has another video called `"$name`" (rename one of them): $($file.FullName)"
  }
  else {
    $chosen[$remote] = $true
    if ($waiting.ContainsKey($remote) -and $waiting[$remote] -eq $file.Length) {
      Write-Host "uploaded already, waiting to be moved in: $name"
    }
    else {
      $toSend += [pscustomobject]@{File = $file; Remote = $remote}
    }
  }
}

$total = [int64]0
foreach ($item in $toSend) {
  $total += $item.File.Length
}
Write-Host ("{0} to upload, {1:N0} MB in all" -f $toSend.Count, ($total / 1MB))
$at = 0
foreach ($item in $toSend) {
  $at++
  Write-Host ("[{0}/{1}] {2} ({3:N0} MB)" -f $at, $toSend.Count, $item.Remote, ($item.File.Length / 1MB))
  # SFTP takes the name as it is, spaces and all; no shell reads it
  & $pscp -batch -sftp -load $Session $item.File.FullName "${Session}:theatre-incoming/$($item.Remote)"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  that upload failed; run this again to retry it"
  }
}

# only what arrived whole goes in: each upload's size on the VPS against
# the file's here. a file cut short stays in ~/theatre-incoming, to be sent
# again (in full) the next time.
$arrived = Read-Listing (& $plink -batch -load $Session "find ~/theatre-incoming -maxdepth 1 -type f -printf '%f\t%s\n'")
$quote = { param($text) "'" + ($text -replace "'", "'\''") + "'" }
$ready = @()
$failed = 0
foreach ($file in $files) {
  $remote = "$(Get-CleanName $file.BaseName)$($file.Extension.ToLower())"
  if ($chosen.ContainsKey($remote)) {
    if ($arrived.ContainsKey($remote) -and $arrived[$remote] -eq $file.Length) {
      $ready += "mv -f -- $(& $quote $remote) ready/"
    }
    else {
      $failed++
    }
    $chosen.Remove($remote)
  }
}
if ($ready.Count -gt 0) {
  Write-Host "Moving $($ready.Count) into the theatre's folder..."
  & $plink -batch -load $Session ("cd ~/theatre-incoming && mkdir -p ready && " + ($ready -join " && ") + " && sudo bash '$Server/tools/install-theatre-videos.sh' ~/theatre-incoming/ready")
  if ($LASTEXITCODE -ne 0) {
    throw "Moving them in did not work: see the lines above."
  }
}
if ($failed -gt 0) {
  Write-Host "$failed did not arrive whole. Run the same command again: what arrived is not sent twice."
  exit 1
}
Write-Host "Done. Staff can play them now: type a video's name in the theatre's box, or use the staff panel's Theatre page."
