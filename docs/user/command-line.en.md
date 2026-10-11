# The command line link (Linux)

UniWork Office ships a command line tool. Settings → General → "Add to terminal"
puts it on your `PATH` as `uniwork-office`, so scripts and AI assistants can create,
convert and read documents without opening the app. Nothing is added until you click.

## What the app does for you

- **deb / rpm installs.** The link points at the package's own launcher, `/usr/bin/genoffice`,
  which stays in place across updates. Because `/usr/bin/uniwork-office` is the app itself, the
  app never puts a second `uniwork-office` in front of it on your `PATH`: the pane then shows
  `genoffice` as the command that is ready to type.
- **Every launch.** The app removes command links it created earlier whose target is gone
  (for example after the package was removed), moves links that point at an older copy of the
  app to the current one, and replaces a link from older versions named `genoffice` by
  `uniwork-office`. Links, files and programs the app did not create are never touched. On
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
