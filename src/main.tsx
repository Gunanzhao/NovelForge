import { startDraftSnapshots } from './lib/draft-snapshots'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { WindowCloseGuard } from './components/WindowCloseGuard'
import './index.css'

startDraftSnapshots()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary label="应用"><App /><WindowCloseGuard /><UnsavedChangesDialog /></ErrorBoundary></React.StrictMode>,
)
