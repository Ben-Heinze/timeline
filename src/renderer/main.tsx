import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useStore } from './store/useStore'
import './index.css'

// Apply the theme to the document root synchronously whenever settings.theme
// changes. This runs inside Zustand's set() — before React re-renders — so the
// data-theme attribute is already correct when components (notably TimelineCanvas,
// which snapshots CSS custom properties via getComputedStyle at render time) read
// their colors. Doing this in a React effect instead runs one commit too late,
// which left the timeline canvas painted in the previous theme until it remounted.
function applyTheme(theme: string | undefined): void {
  document.documentElement.setAttribute('data-theme', theme ?? 'light')
}
applyTheme(useStore.getState().settings?.theme)
useStore.subscribe((state, prev) => {
  if (state.settings?.theme !== prev.settings?.theme) applyTheme(state.settings?.theme)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
