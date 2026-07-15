/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.timeline.app',
  productName: 'Timeline',
  directories: {
    buildResources: 'build',
    output: 'dist',
  },
  // electron-vite bundles all app code into out/; production dependencies
  // (the native/externalized ones) are added by electron-builder automatically.
  files: ['out/**/*', 'package.json'],
  asarUnpack: [
    'node_modules/better-sqlite3/**/*',
    'node_modules/sharp/**/*',
    'node_modules/@img/**/*',
    // ExifTool ships a Perl script / standalone binary that must be exec'd from
    // disk, so it can't live inside the asar archive.
    'node_modules/exiftool-vendored/**/*',
    'node_modules/exiftool-vendored.pl/**/*',
    'node_modules/exiftool-vendored.exe/**/*',
    // ffmpeg-static's binary is spawned from disk to build video thumbnails.
    'node_modules/ffmpeg-static/**/*',
  ],
  win: {
    target: ['nsis', 'zip'],
    icon: 'build/icon.png',
  },
  mac: {
    // Cover Apple Silicon (arm64) and Intel (x64). No paid Apple Developer
    // account, so the app is ad-hoc signed only: downloaded builds are
    // Gatekeeper-quarantined and users must "Open Anyway" in Privacy &
    // Security (or `xattr -dr com.apple.quarantine Timeline.app`).
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.utilities',
    icon: 'build/icon.png',
    identity: null,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
    icon: 'build/icon.png',
  },
}
