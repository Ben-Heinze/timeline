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
  '';
}
