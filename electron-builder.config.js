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
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
    icon: 'build/icon.png',
  },
}
