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
    #!/usr/bin/env bash
    set -e
    nix-shell shell.nix --run "npm install"
    ELECTRON_NIX=$(nix-build --no-out-link '<nixpkgs>' -A electron 2>/dev/null)
    ln -sf "$ELECTRON_NIX/bin/electron" node_modules/electron/dist/electron
    nix-shell shell.nix --run "npm run rebuild"

rebuild:
    nix-shell shell.nix --run "npm run rebuild"

# NixOS can't run electron-builder's bundled FHS tools (7za/mksquashfs), so
# only the unpacked dir builds locally — installers come from the GitHub
# Actions release workflow (push a v* tag).
package:
    nix-shell shell.nix --run "npm run build && npx electron-builder --config electron-builder.config.js --linux --dir"
