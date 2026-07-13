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
