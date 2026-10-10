import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Embed, { EMBED_CSS } from './Embed'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <style>{EMBED_CSS}</style>
    <Embed />
  </StrictMode>,
)
