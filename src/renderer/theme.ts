export type ThemeName = 'light' | 'dark' | 'sepia' | 'midnight' | 'sky'

export const THEMES: { name: ThemeName; label: string; preview: { bg: string; surface: string; accent: string } }[] = [
  { name: 'light',    label: 'Light',    preview: { bg: '#f8f8f5', surface: '#ffffff',  accent: '#f59e0b' } },
  { name: 'dark',     label: 'Dark',     preview: { bg: '#111110', surface: '#1c1c1a',  accent: '#f59e0b' } },
  { name: 'sepia',    label: 'Sepia',    preview: { bg: '#f2ede3', surface: '#fdf8f0',  accent: '#b87333' } },
  { name: 'midnight', label: 'Midnight', preview: { bg: '#0d0f1a', surface: '#141620',  accent: '#7c6bff' } },
  { name: 'sky',      label: 'Sky',      preview: { bg: '#eef4fb', surface: '#f8fbff',  accent: '#0284c7' } },
]
