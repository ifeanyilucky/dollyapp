import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AreaSelectorView } from './recorder/AreaSelectorView'
import { ToolbarView } from './recorder/ToolbarView'

// The area-selector overlay and the floating toolbar are both separate
// Tauri windows (see `open_area_selector` and `toolbar::show` in the Rust
// backend), not routes inside the main app — each loads this same
// `index.html` with a `?mode=` query param to pick a different root
// instead of the normal app.
const mode = new URLSearchParams(window.location.search).get('mode')

function root() {
  if (mode === 'area-select') return <AreaSelectorView />
  if (mode === 'toolbar') return <ToolbarView />
  return <App />
}

createRoot(document.getElementById('root')!).render(<StrictMode>{root()}</StrictMode>)
