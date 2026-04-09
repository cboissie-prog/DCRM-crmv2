import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '../../store/authStore'
import { ToastContainer } from '../ui/Toast'

export function Layout() {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <Header />
      <main className="ml-60 pt-14 min-h-screen">
        <div className="p-6 fade-in">
          <Outlet />
        </div>
      </main>
      <ToastContainer />
    </div>
  )
}
