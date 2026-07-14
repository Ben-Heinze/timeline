{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22
    ffmpeg
    python3
    pkg-config
    vips
    libpng
    libjpeg
    libwebp
    giflib
    gcc
    gnumake
    stdenv.cc.cc.lib
  ];

  shellHook = ''
    export npm_config_cache="$HOME/.npm"
    export PKG_CONFIG_PATH="${pkgs.vips}/lib/pkgconfig:${pkgs.libpng.dev}/lib/pkgconfig:$PKG_CONFIG_PATH"
    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.vips}/lib:$LD_LIBRARY_PATH"
    # sharp detects the global Nix libvips via PKG_CONFIG_PATH above and builds
    # from source on every npm install, not just `npm run rebuild:sharp`.
    # node-addon-api 8.x needs C++17 but sharp's binding.gyp pins -std=c++0x.
    export CXXFLAGS=-std=c++17
  '';
}
