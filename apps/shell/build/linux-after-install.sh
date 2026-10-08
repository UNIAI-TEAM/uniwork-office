#!/bin/sh
# deb/rpm post-install: expose the genoffice command line shipped inside the app.
set -e
launcher="/opt/UniWork Office/resources/cli/genoffice"
if [ -x "$launcher" ]; then
  ln -sf "$launcher" /usr/bin/genoffice
fi
exit 0
