/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.timeline.app',
  productName: 'Timeline',
  directories: {
    buildResources: 'build',
    output: 'dist',
  },
  files: ['out/**/*', 'node_modules/**/*'],
  asarUnpack: [
    'node_modules/better-sqlite3/**/*',
    'node_modules/sharp/**/*',
    'node_modules/fluent-ffmpeg/**/*',
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.lifestyle',
  },
  win: {
    target: ['nsis', 'zip'],
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
  },
}
