nix := "nix-shell -p nodejs_22 --run"

run:
    #!/usr/bin/env bash
    set -e
    ELECTRON_NIX=$(nix-build --no-out-link '<nixpkgs>' -A electron 2>/dev/null)
    ln -sf "$ELECTRON_NIX/bin/electron" node_modules/electron/dist/electron
    nix-shell shell.nix --run "npm run dev"

build:
    {{nix}} "npm run build"

install:
    nix-shell shell.nix --run "npm install"

rebuild:
    nix-shell shell.nix --run "npm run rebuild"

package:
    nix-shell shell.nix --run "npm run package"
