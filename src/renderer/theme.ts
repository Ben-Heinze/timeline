export type ThemeName =
  | 'light' | 'dark' | 'sepia' | 'midnight' | 'sky' | 'forest'
  | 'latte' | 'frappe' | 'macchiato' | 'mocha'

export const THEMES: { name: ThemeName; label: string; preview: { bg: string; surface: string; accent: string } }[] = [
  { name: 'light',     label: 'Light',     preview: { bg: '#f8f8f5', surface: '#ffffff',  accent: '#f59e0b' } },
  { name: 'dark',      label: 'Dark',      preview: { bg: '#111110', surface: '#1c1c1a',  accent: '#f59e0b' } },
  { name: 'sepia',     label: 'Sepia',     preview: { bg: '#f2ede3', surface: '#fdf8f0',  accent: '#b87333' } },
  { name: 'midnight',  label: 'Midnight',  preview: { bg: '#0d0f1a', surface: '#141620',  accent: '#7c6bff' } },
  { name: 'sky',       label: 'Sky',       preview: { bg: '#eef4fb', surface: '#f8fbff',  accent: '#0284c7' } },
  { name: 'forest',    label: 'Forest',    preview: { bg: '#0c1410', surface: '#131f18',  accent: '#10b981' } },
  // Catppuccin (catppuccin.com) — four official flavors, palettes reproduced as published.
  { name: 'latte',     label: 'Latte',     preview: { bg: '#e6e9ef', surface: '#eff1f5',  accent: '#1e66f5' } },
  { name: 'frappe',    label: 'Frappé',    preview: { bg: '#232634', surface: '#303446',  accent: '#8caaee' } },
  { name: 'macchiato', label: 'Macchiato', preview: { bg: '#181926', surface: '#24273a',  accent: '#8aadf4' } },
  { name: 'mocha',     label: 'Mocha',     preview: { bg: '#11111b', surface: '#1e1e2e',  accent: '#89b4fa' } },
]
