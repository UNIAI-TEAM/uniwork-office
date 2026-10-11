#!/bin/bash
# deb/rpm post-install. electron-builder runs this INSTEAD of its default
# after-install template (templates/linux/after-install.tpl), so the first part
# repeats that template's steps; ${executable} and ${sanitizedProductName} are
# its macros, filled in at packaging time. The last part exposes the command line
# (uniwork-office-cli) shipped inside the app.

# The /usr/bin/<executable> launcher link.
if type update-alternatives >/dev/null 2>&1; then
  # a link that does not go through update-alternatives is replaced
  if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] \
    && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
  fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 \
    || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
  ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# The SUID chrome-sandbox only where user namespaces do not work.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; } 2>/dev/null; then
  chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
  chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

# Desktop entry and mime caches: the file associations and the uniwork://,
# uniwork-office:// (and on dev / beta builds uniwork-office-dev://) URL
# handlers declared in the .desktop MimeType take effect from these.
if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

# AppArmor profile (Ubuntu 24.04 and later restrict unprivileged user
# namespaces; without the profile the sandboxed app does not start). Skipped
# when the running AppArmor cannot parse it (Ubuntu 22.04 needs none).
if apparmor_status --enabled >/dev/null 2>&1; then
  apparmor_source='/opt/${sanitizedProductName}/resources/apparmor-profile'
  apparmor_target='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$apparmor_source" >/dev/null 2>&1; then
    cp -f "$apparmor_source" "$apparmor_target"
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$apparmor_target" || true
    fi
  fi
fi

# The command line, /usr/bin/uniwork-office-cli. Only an absent name, a dead link
# or a link into our own install dir is taken over; anything else at that name
# belongs to another program (genoffice#893). This link is also the stable
# launcher the app's own per-user link points at (never the versioned /opt
# path): removing the package leaves at most a dead link to a file the package
# owned, which the app removes at its next launch. The command has its own name
# because /usr/bin/uniwork-office is the desktop app itself. Earlier packages
# also linked /usr/bin/genoffice; that name is no longer created, and a leftover
# link of ours is dropped here (another program's genoffice stays untouched).
app_dir='/opt/${sanitizedProductName}'
launcher="$app_dir/resources/cli/genoffice"
link=/usr/bin/uniwork-office-cli
old_link=/usr/bin/genoffice
if [ -L "$old_link" ]; then
  case "$(readlink "$old_link")" in
    "$app_dir/"*) rm -f "$old_link" ;;
  esac
fi
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    "$app_dir/"*) ;;
    *) [ -e "$link" ] && { echo "uniwork-office-cli: $link is another program, left as is; run: ln -s \"$launcher\" \"$link\"" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "uniwork-office-cli: $link is another program, left as is; run: ln -s \"$launcher\" \"$link\"" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0
