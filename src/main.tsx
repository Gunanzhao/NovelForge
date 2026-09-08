import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { WindowCloseGuard } from './components/WindowCloseGuard'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /><WindowCloseGuard /><UnsavedChangesDialog /></React.StrictMode>,
)
