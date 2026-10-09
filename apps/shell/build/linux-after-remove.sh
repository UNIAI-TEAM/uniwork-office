#!/bin/bash
# deb/rpm post-remove, run INSTEAD of electron-builder's default after-remove
# template, so it repeats that template's cleanup (launcher link, AppArmor
# profile) and drops the genoffice command-line link. Only on a real
# uninstall: rpm runs the old package's %postun after the new %post during an
# upgrade (with $1 = 1); deb passes "upgrade" there. Removing then would kill
# what the new version just set up.
case "$1" in
  0|remove|purge) ;;
  *) exit 0 ;;
esac

if ! { type update-alternatives >/dev/null 2>&1 && update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'; }; then
  rm -f '/usr/bin/${executable}'
fi

apparmor_target='/etc/apparmor.d/${executable}'
if [ -f "$apparmor_target" ]; then
  if apparmor_status --enabled >/dev/null 2>&1; then
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$apparmor_target" || true
    fi
  fi
  rm -f "$apparmor_target"
fi

# An organization deployment profile copied into resources/ is not a package
# file; drop it (and the then-empty install dir) like the Windows uninstaller.
rm -f '/opt/${sanitizedProductName}/resources/deployment-profile.json'
rmdir '/opt/${sanitizedProductName}/resources' '/opt/${sanitizedProductName}' 2>/dev/null || true

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

# same ownership rule as the post-install: only a link into our install dir is ours
link=/usr/bin/genoffice
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    '/opt/${sanitizedProductName}/'*) rm -f "$link" ;;
  esac
fi
exit 0
