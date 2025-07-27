import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import Header from './components/common/Header';
import Landing from './pages/Landing';
import TestComponent from './components/TestComponent';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import DashboardLayout from './components/dashboard/DashboardLayout';
import Overview from './components/dashboard/Overview';
import Orders from './components/dashboard/Orders';
import Positions from './components/dashboard/Positions';
import ForgotPassword from './components/auth/ForgotPassword';
import VerifyOtpResetPassword from './components/auth/VerifyOtpResetPassword';
import ResetPassword from './components/auth/ResetPassword';
import PnL from './components/dashboard/PnL';
import BrokerConnection from './components/dashboard/BrokerConnection';
import WebhookSyntaxGenerator from './components/dashboard/WebhookSyntaxGenerator';
import SymbolsManagement from './components/dashboard/SymbolsManagement';
import SubscriptionPlans from './components/subscription/SubscriptionPlans';
import SubscriptionGuard from './components/subscription/SubscriptionGuard';
import { isAuthenticated } from './utils/auth';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gradient-to-br from-cream-50 to-beige-100">
        <Header />
        <AnimatePresence mode="wait">
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/verify-otp-reset-password" element={<VerifyOtpResetPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/subscription" element={<SubscriptionPlans />} />
            <Route path="/test" element={<TestComponent />} />
            
            {/* Protected Dashboard Routes */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <SubscriptionGuard>
                  <DashboardLayout />
                </SubscriptionGuard>
              </ProtectedRoute>
            }>
              <Route index element={<Overview />} />
              <Route path="orders" element={<Orders />} />
              <Route path="positions" element={<Positions />} />
              <Route path="pnl" element={<PnL />} />
              <Route path="brokers" element={<BrokerConnection />} />
              <Route path="webhook-syntax" element={<WebhookSyntaxGenerator />} />
              <Route path="symbols" element={<SymbolsManagement />} />
            </Route>
            
            {/* Catch all route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#f8f5f0',
              color: '#8b4513',
              border: '1px solid #d2b48c',
            },
          }}
        />
      </div>
    </Router>
  );
}

export default App;
