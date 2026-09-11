import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'

// D-58 (E3.3). framer-motion animates with JS-driven inline styles, so the
// `@media (prefers-reduced-motion: reduce)` block in CSS CANNOT stop it --
// its default `reducedMotion` is "never". One MotionConfig at the root makes
// every `motion.*` component on this surface honour the OS setting, which is
// why this is here rather than a useReducedMotion() call per component:
// E3's job is to define a thing ONCE.
//
// This surface has NINE framer components (Idle, Main, How, Catalogue,
// Lockers, Success, Offline, AnimatedLock, BlockAssembly) and not one of them
// consulted the setting before this line.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
