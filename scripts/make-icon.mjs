// Generates build/icon.png (512x512) — dark rounded square with an
// amber timeline histogram, matching the app's default accent (#f59e0b).
// Run: nix-shell shell.nix --run "node scripts/make-icon.mjs"
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const bars = [
  [72, 60], [128, 110], [184, 160], [240, 230], [296, 150], [352, 200], [408, 90],
].map(([x, h]) =>
  `<rect x="${x}" y="${392 - h}" width="36" height="${h}" rx="8" fill="url(#amber)"/>`
).join('\n  ')

const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="amber" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="#1c1c1a"/>
  ${bars}
  <rect x="56" y="400" width="400" height="10" rx="5" fill="#57534e"/>
  <circle cx="258" cy="405" r="17" fill="#fbbf24" stroke="#1c1c1a" stroke-width="7"/>
</svg>`

fs.mkdirSync(path.join(root, 'build'), { recursive: true })
await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'build', 'icon.png'))
console.log('wrote build/icon.png')
