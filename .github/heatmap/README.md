# heatmap

Renders `heatmap/heatmap.svg` (public commits, forks included) and keeps it current: `watch.ts`
notices a new public push within about a minute, waits 20 s for pushes to settle, rebuilds the
image, and pushes it as `heatmap-bot` (an identity not linked to the account, so its commits are
never counted).

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

The watcher pulls before every run, so other repo changes (like the profile `README.md`) need
nothing on the server. After changing files in this folder, push, then restart the task
(`Stop-ScheduledTask heatmap; Start-ScheduledTask heatmap`): a running process keeps its old code.
After a force-push, sync the server with `git -C C:\heatmap\fosterbarnes fetch` and
`git -C C:\heatmap\fosterbarnes reset --hard origin/main`, then restart the task.
Re-run `install.ps1` if your Windows password changes. Set `HEATMAP_TZ` to change the time zone
(default `America/New_York`).

## Behavior

- Polls `/users/<you>/repos?sort=pushed` every 30 s with an ETag; unchanged answers (304) are free.
- Hourly full check catches commits to other people's repos.
- Pushes only when the set of your commits changed (SHA fingerprint), so the bot's own push ends
  in "no new commits".
- One run at a time; pushes during a run queue one follow-up run. Errors retry after 5 min.
- No network at boot is fine: polls log the failure and keep retrying. The task also relaunches the
  watcher within 5 minutes if the process ever exits.
- State and log: `%LOCALAPPDATA%\heatmap\` (`state.json`, `heatmap.log`, rotated at 1 MB).
- GitHub caches the image up to 5 min, so the profile can lag a push by that much.
