# The command line link

UniWork Office ships a command line tool. Its command is `uniwork-office-cli` on every system
(Windows, macOS and Linux). Settings → General → "Add to terminal" puts it on your `PATH`, so
scripts and AI assistants can create, convert and read documents without opening the app.
Nothing is added until you click. The command has its own name on purpose: on Linux
`uniwork-office` starts the app itself, so the command line never takes that name.

## What the app does for you

- **deb / rpm installs.** The package puts the command on your `PATH` as `/usr/bin/uniwork-office-cli`,
  and it stays in place across updates. The pane shows `uniwork-office-cli` as ready to type, and that
  is the name to use in scripts and assistants. Earlier packages also created `/usr/bin/genoffice`;
  installing this version removes that link when it points into the app's own folder (a `genoffice`
  that belongs to another program is left alone).
- **Windows.** The installer adds the app's `resources\cli` folder to your user `PATH`, and that folder
  holds `uniwork-office-cli.cmd` (for cmd and PowerShell) and `uniwork-office-cli` (for Git Bash).
- **macOS, AppImage and tarball.** "Add to terminal" links `uniwork-office-cli` into `/usr/local/bin`
  (or `/opt/homebrew/bin`, then `~/.local/bin`).
- **Every launch.** The app removes command links it created earlier whose target is gone
  (for example after the package was removed), moves a link that points at an older path of the
  same installation (for example the versioned folder) to the current launcher, and replaces links
  from older versions, named `genoffice` or `uniwork-office`, by `uniwork-office-cli`. It only ever
  looks in `/usr/local/bin`, `/opt/homebrew/bin`, `$XDG_BIN_HOME` and `~/.local/bin`, and only at
  symbolic links that lead to the app's own command line launcher: the app itself
  (`uniwork-office`), another program's `genoffice` or `uniwork-office`, files, and working links
  that lead into another installation (for example another build or another copy of the app
  installed next to this one) are never touched. On a deb / rpm install, where
  `/usr/bin/uniwork-office-cli` already answers, such a link adds nothing and is dropped. On
  Linux it also drops a stale `uniwork://` entry from `~/.config/mimeapps.list` when the app's
  desktop file no longer exists.
- **Removing the package.** The package removes `/usr/bin/uniwork-office-cli` itself (only when it
  points into the app's folder). It cannot reach files in your home folder (the remove step
  runs as root), so a link you added may stay behind until the next time the app starts. A
  dangling link is harmless; it only makes the command report "No such file or directory".

## Manual cleanup: you deleted the AppImage

If you ran the AppImage and then deleted the file, the app is no longer there to tidy up after
itself. Remove what is left by hand:

```sh
# command links that point at nothing (only delete ones listed as broken)
ls -l ~/.local/bin/uniwork-office-cli ~/.local/bin/uniwork-office ~/.local/bin/genoffice \
  /usr/local/bin/uniwork-office-cli /usr/local/bin/uniwork-office /usr/local/bin/genoffice 2>/dev/null
rm -f ~/.local/bin/uniwork-office-cli ~/.local/bin/genoffice

# the uniwork:// handler: delete these lines from the file, if present
#   x-scheme-handler/uniwork=...
#   x-scheme-handler/uniwork-office=...
${EDITOR:-nano} ~/.config/mimeapps.list

# optional: the app's settings and cache
rm -rf "$HOME/.config/UniWork Office"
```

Only remove a link when `ls -l` shows its target is missing or inside the AppImage's `.mount_…`
folder. A link that points at a working program belongs to something else.
Do not delete `uniwork-office` unless it is a broken link: on some systems it is the app itself.
