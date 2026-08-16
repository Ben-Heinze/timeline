{
  description = "Timeline — interactive lifelong memory timeline (Electron app)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    # Desktop Electron app — only the Linux systems where NixOS matters.
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;

        # Pin Electron to the same major the app depends on (package.json:
        # "electron": "41.7.2") so the native modules we rebuild below match
        # Electron's ABI exactly.
        electron = pkgs.electron_41;

        pkg = lib.importJSON ./package.json;

        # @electron/rebuild (a direct devDependency) is the only thing that
        # pulls in @electron/node-gyp, the lockfile's sole git dependency, which
        # can't be fetched in the pure build sandbox. It's used only by the
        # app's manual `npm run rebuild` workflow — the Nix build rebuilds
        # better-sqlite3 itself — so strip it from package.json + the lockfile
        # before importNpmLock reads them.
        patchedSrc = pkgs.runCommand "timeline-source"
          { nativeBuildInputs = [ pkgs.jq ]; } ''
          cp -r ${self} $out
          chmod -R u+w $out
          cd $out
          jq 'del(.devDependencies["@electron/rebuild"])' package.json > p \
            && mv p package.json
          jq '
            del(.packages[""].devDependencies["@electron/rebuild"])
            | .packages |= with_entries(select(.key
                | (startswith("node_modules/@electron/rebuild")
                   or startswith("node_modules/@electron/node-gyp")) | not))
          ' package-lock.json > p && mv p package-lock.json
        '';

        timeline = pkgs.buildNpmPackage {
          pname = "timeline";
          inherit (pkg) version;

          src = patchedSrc;

          # Reproducible node_modules straight from package-lock.json — no
          # vendored hash to maintain.
          npmDeps = pkgs.importNpmLock {
            npmRoot = patchedSrc;
          };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          nativeBuildInputs = [
            pkgs.python3 # node-gyp
            pkgs.pkg-config # sharp's source build finds libvips via pkg-config
            pkgs.makeWrapper
            pkgs.nodejs
            pkgs.node-gyp
          ];

          # libvips for sharp's from-source build (see preBuild).
          buildInputs = [ pkgs.vips ];

          # Skip dependency install scripts: they only download prebuilt
          # binaries from the network (electron, ffmpeg-static, better-sqlite3's
          # prebuild-install), which the sandbox forbids. We provide Electron
          # and ffmpeg from Nix, rebuild better-sqlite3 in preBuild, and rely on
          # sharp's prebuilt N-API @img/* package.
          npmFlags = [ "--ignore-scripts" ];
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

          # better-sqlite3 is an ABI-specific native addon: rebuild it against
          # Electron's headers so its NODE_MODULE_VERSION matches the runtime we
          # launch with. Compile with the Nix node-gyp directly rather than
          # `npm rebuild`, which would try to fetch @electron/rebuild's
          # @electron/node-gyp git dependency (impossible in the sandbox).
          #
          # sharp is deliberately NOT rebuilt: 0.33 uses N-API, so its prebuilt
          # @img/sharp-linux-* binary is ABI-stable and bundles its own libvips.
          preBuild = ''
            # Rebuild native modules via npm's own (unpatched) node-gyp, which
            # honours npm_config_nodedir — the Nix `node-gyp` is patched to
            # ignore it and use the build nodejs.
            #
            #  - better-sqlite3: ABI-specific, compile against Electron's headers.
            #  - sharp: its prebuilt @img binary bundles a libvips that aborts
            #    with a VIPS_IS_OBJECT assertion on NixOS/Electron, so build it
            #    from source against the Nix libvips instead (node-addon-api 8
            #    needs C++17; sharp's binding.gyp otherwise pins c++0x).
            export npm_config_nodedir=${electron.headers}
            export npm_config_build_from_source=true
            # better-sqlite3 includes V8 headers, which need C++20 on Electron 41
            # (its binding.gyp sets this itself, so don't force a std here).
            npm rebuild --foreground-scripts better-sqlite3
            # sharp is N-API only (no V8 headers); node-addon-api 8 needs C++17.
            SHARP_FORCE_GLOBAL_LIBVIPS=1 CXXFLAGS=-std=c++17 \
              npm rebuild --foreground-scripts sharp
          '';

          # `npm run build` == electron-vite build -> out/{main,preload,renderer}
          npmBuildScript = "build";

          installPhase = ''
            runHook preInstall

            # Drop build-only dependencies from the shipped tree (the app's
            # runtime deps are all in "dependencies"; the renderer bundles the
            # rest). Keeps the source-built better-sqlite3/sharp binaries.
            npm prune --omit=dev --ignore-scripts

            mkdir -p $out/share/timeline
            cp -r out package.json node_modules $out/share/timeline/

            # ffmpeg-static ships a prebuilt ffmpeg binary that can't exec on
            # NixOS; point it at the Nix ffmpeg instead.
            ln -sf ${pkgs.ffmpeg}/bin/ffmpeg \
              $out/share/timeline/node_modules/ffmpeg-static/ffmpeg

            makeWrapper ${electron}/bin/electron $out/bin/timeline \
              --add-flags $out/share/timeline \
              --prefix PATH : ${lib.makeBinPath [ pkgs.perl pkgs.ffmpeg ]} \
              --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.vips ]} \
              --set-default ELECTRON_OZONE_PLATFORM_HINT auto

            install -Dm644 build/icon.png \
              $out/share/icons/hicolor/512x512/apps/timeline.png

            runHook postInstall
          '';

          meta = {
            description = pkg.description;
            homepage = "https://github.com/Ben-Heinze/timeline";
            mainProgram = "timeline";
            platforms = [ "x86_64-linux" "aarch64-linux" ];
            # No LICENSE file in the repo yet; add `license = lib.licenses.…`
            # here once one is chosen.
          };
        };
      in
      {
        packages.default = timeline;
        packages.timeline = timeline;

        apps.default = {
          type = "app";
          program = "${timeline}/bin/timeline";
        };

        devShells.default = import ./shell.nix { inherit pkgs; };
      });
}
