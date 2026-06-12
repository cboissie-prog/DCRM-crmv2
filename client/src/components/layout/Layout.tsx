import { useState } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '../../store/authStore'
import { ToastContainer } from '../ui/Toast'

export function Layout() {
  const { isAuthenticated } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Overlay mobile — ferme la sidebar au clic */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[1000] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Header onMenuClick={() => setSidebarOpen(v => !v)} />

      <main className="lg:ml-60 pt-14 min-h-screen">
        <div className="p-4 md:p-6 fade-in">
          <Outlet />
        </div>
      </main>

      <ToastContainer />
    </div>
  )
}
