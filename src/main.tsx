import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { wireEngine } from './app/wire'
import { App } from './ui/App'
import './ui/styles.css'

wireEngine()

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
