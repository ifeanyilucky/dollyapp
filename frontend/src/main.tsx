import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AreaSelectorView } from './recorder/AreaSelectorView'

// The area-selector overlay is a separate Tauri window (see
// `open_area_selector` in the Rust backend), not a route inside the main
// app — it loads the same `index.html` with `?mode=area-select` in the
// URL to pick this root instead of the normal app.
const isAreaSelector = new URLSearchParams(window.location.search).get('mode') === 'area-select'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAreaSelector ? <AreaSelectorView /> : <App />}
  </StrictMode>,
)
