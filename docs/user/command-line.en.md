# The command line link (Linux)

UniWork Office ships a command line tool. Settings → General → "Add to terminal"
puts it on your `PATH` as `uniwork-office`, so scripts and AI assistants can create,
convert and read documents without opening the app. Nothing is added until you click.

## What the app does for you

- **deb / rpm installs: the command stays `genoffice`.** The package already puts its own
  launcher on your `PATH` as `/usr/bin/genoffice`, and it stays in place across updates. Typing
  `uniwork-office` there opens the app (`/usr/bin/uniwork-office` is the app itself), so the app
  does not add a `uniwork-office` command line link in front of it: the pane shows `genoffice` as
  the command that is ready to type, and `genoffice` is what to use in scripts and assistants.
  The `uniwork-office` command name applies to AppImage, tarball and macOS installs.
- **Every launch.** The app removes command links it created earlier whose target is gone
  (for example after the package was removed), moves a link that points at an older path of the
  same installation (for example the versioned folder) to the current launcher, and replaces a link from older versions named `genoffice` by
  `uniwork-office`. Links, files and programs the app did not create are never touched, and
  neither is a working link that leads into another installation (for example another build or
  another copy of the app installed next to this one). On
  Linux it also drops a stale `uniwork://` entry from `~/.config/mimeapps.list` when the app's
  desktop file no longer exists.
- **Removing the package.** The package cannot reach files in your home folder (the remove step
  runs as root), so a link you added may stay behind until the next time the app starts. A
  dangling link is harmless; it only makes the command report "No such file or directory".

## Manual cleanup: you deleted the AppImage

If you ran the AppImage and then deleted the file, the app is no longer there to tidy up after
itself. Remove what is left by hand:

```sh
# command links that point at nothing (only delete ones listed as broken)
ls -l ~/.local/bin/uniwork-office ~/.local/bin/genoffice /usr/local/bin/uniwork-office /usr/local/bin/genoffice 2>/dev/null
rm -f ~/.local/bin/uniwork-office ~/.local/bin/genoffice

# the uniwork:// handler: delete these lines from the file, if present
#   x-scheme-handler/uniwork=...
#   x-scheme-handler/uniwork-office=...
${EDITOR:-nano} ~/.config/mimeapps.list

# optional: the app's settings and cache
rm -rf "$HOME/.config/UniWork Office"
```

Only remove a link when `ls -l` shows its target is missing or inside the AppImage's `.mount_…`
folder. A link that points at a working program belongs to something else.
