import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './index.css'
import { registerServiceWorker } from './lib/push'
import { ErrorBoundary, initMonitoring } from './lib/monitoring'
import CrashScreen from './components/CrashScreen'

initMonitoring()

registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashScreen />}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
