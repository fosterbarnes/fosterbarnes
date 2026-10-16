# heatmap

Renders `heatmap/heatmap-<hash>.svg` (public commits, forks included) and keeps it current: `watch.ts`
notices a new public push within about a minute, waits 20 s for pushes to settle, rebuilds the
image, and pushes it as `heatmap-bot` (an identity not linked to the account, so its commits are
never counted). It also pushes at the top of every hour so the current-hour markers stay right
with no commits.

## Server setup

Needs Node 24+, Git, and GitHub CLI on PATH.

```powershell
gh auth login                                        # once, as the user the task will run as
git clone https://github.com/fosterbarnes/fosterbarnes C:\heatmap\fosterbarnes
C:\heatmap\fosterbarnes\.github\heatmap\install.ps1  # asks for your Windows password once
```

## Everyday commands

```powershell
Get-Content $env:LOCALAPPDATA\heatmap\heatmap.log -Tail 20 -Wait   # watch it work
node C:\heatmap\fosterbarnes\.github\heatmap\watch.ts --once       # update right now
Get-ScheduledTask heatmap | Select-Object State                    # is it running
C:\heatmap\fosterbarnes\.github\heatmap\install.ps1 -Uninstall     # remove
```

Every run resets the server clone to `origin/main` (`fetch` + `reset --hard`), so other repo
changes and force-pushes need nothing on the server, and edits made by hand in
`C:\heatmap\fosterbarnes` are wiped. After changing files in this folder, push, then restart the
task (`Stop-ScheduledTask heatmap; Start-ScheduledTask heatmap`): a running process keeps its old
code. The bot rewrites the heatmap `<img src>` line in the profile `README.md` on every update, so
pull before editing the README locally. Re-run `install.ps1` if your Windows password changes. Set `HEATMAP_TZ` to change the time zone
(default `America/New_York`).

## Behavior

- Polls `/users/<you>/repos?sort=pushed` every 30 s with an ETag; unchanged answers (304) are free.
- Each new hour in `HEATMAP_TZ` queues a run. It's a full rebuild, so it also catches commits to
  other people's repos and missed polls.
- Commits only when the image differs from the committed one. The image depends only on your
  commits and the current hour, so the bot's own push ends in "image unchanged".
- Pushes and hour changes share one queue: one run at a time, and anything that happens during a
  run queues one follow-up run. A rejected push re-syncs and retries once; errors retry after 5 min.
- No network at boot is fine: polls log the failure and keep retrying. The task also relaunches the
  watcher within 5 minutes if the process ever exits.
- State and log: `%LOCALAPPDATA%\heatmap\` (`state.json`, `heatmap.log`, rotated at 1 MB).
- Each image is named after a hash of its content and the profile `README.md` points at it.
  GitHub serves the image from a URL with a 5 min cache and its redirect drops query strings
  (`?v=` does nothing), so a new file name is what makes browsers fetch the new image.
