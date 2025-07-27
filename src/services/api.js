import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Create axios instance with better error handling
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log(`🌐 API Request: ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

// Enhanced response interceptor with better error handling
api.interceptors.response.use(
  (response) => {
    console.log(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
    return response;
  },
  (error) => {
    console.error(`❌ API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, error);
    
    // Handle 401 unauthorized responses
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    
    // Enhanced error information
    if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
      console.error('❌ Server connection failed. Please check if the Node.js API server is running on port 3001.');
      error.message = 'Unable to connect to server. Please check your connection and try again.';
    }
    
    return Promise.reject(error);
  }
);

// Auth API - Updated for Node.js Express endpoints
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/me'),
  verifyOtp: ({ identifier, otp }) => api.post('/auth/verify-otp', { identifier, otp }),
  resendOtp: ({ identifier }) => api.post('/auth/resend-otp', { identifier }),
  verifyOtpForReset: ({ identifier, otp }) => api.post('/auth/verify-otp-reset', { identifier, otp }),
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  resetPassword: ({ resetToken, newPassword }) => api.post('/auth/reset-password', { resetToken, newPassword }),
};

// Enhanced Broker API - Updated for Node.js Express endpoints
export const brokerAPI = {
  getConnections: () => api.get('/broker/connections'),
  getConnection: (id) => api.get(`/broker/connections/${id}`),
  connect: async (data) => {
    try {
      console.log('🔗 Attempting broker connection with data:', { 
        brokerName: data.brokerName, 
        connectionName: data.connectionName,
        hasApiKey: !!data.apiKey, 
        hasApiSecret: !!data.apiSecret,
        userId: data.userId 
      });
      
      const response = await api.post('/broker/connect', data);
      console.log('✅ Broker connection response:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Broker connection failed:', error);
      throw error;
    }
  },
  disconnect: (connectionId) => api.post('/broker/disconnect', { connectionId }),
  deleteConnection: (connectionId) => api.delete(`/broker/connections/${connectionId}`),
  
  // Reconnect using stored credentials
  reconnect: async (connectionId) => {
    try {
      console.log('🔄 Attempting to reconnect using stored credentials for connection:', connectionId);
      const response = await api.post(`/broker/reconnect/${connectionId}`);
      console.log('✅ Reconnect response:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Reconnect failed:', error);
      throw error;
    }
  },
  
  syncPositions: (connectionId) => api.post(`/broker/sync/positions/${connectionId}`),
  testConnection: (connectionId) => api.post(`/broker/test/${connectionId}`),
  
  // Real-time positions API
  getPositions: async (connectionId) => {
    try {
      console.log('📊 Fetching real-time positions for connection:', connectionId);
      const response = await api.get(`/broker/positions/${connectionId}`);
      console.log('✅ Positions fetched:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Failed to fetch positions:', error);
      throw error;
    }
  },
  
  getHoldings: async (connectionId) => {
    try {
      console.log('📈 Fetching real-time holdings for connection:', connectionId);
      const response = await api.get(`/broker/holdings/${connectionId}`);
      console.log('✅ Holdings fetched:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Failed to fetch holdings:', error);
      throw error;
    }
  },
  
  // Angel Broking manual authentication
  angelAuth: async (data) => {
    try {
      console.log('👼 Angel Broking manual authentication for connection:', data.connectionId);
      const response = await api.post('/broker/auth/angel/login', data);
      console.log('✅ Angel authentication successful:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Angel authentication failed:', error);
      throw error;
    }
  },
  
  // Shoonya manual authentication
  shoonyaAuth: async (data) => {
    try {
      console.log('🚀 Shoonya manual authentication for connection:', data.connectionId);
      const response = await api.post('/auth/shoonya/login', data);
      console.log('✅ Shoonya authentication successful:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Shoonya authentication failed:', error);
      throw error;
    }
  },
};

// Enhanced Orders API - Updated for Node.js Express endpoints
export const ordersAPI = {
  getOrders: (params) => api.get('/orders', { params }),
  getOrderDetails: (orderId, params) => api.get(`/orders/${orderId}`, { params }),
  syncOrders: (brokerConnectionId) => api.post(`/orders/sync/${brokerConnectionId}`),
  updateOrderStatus: (orderId, data) => api.patch(`/orders/${orderId}/status`, data),
  getPositions: (params) => api.get('/orders/positions', { params }),
  getPnL: (params) => api.get('/orders/pnl', { params }),
  
  // Real-time order monitoring
  startOrderPolling: async (orderId) => {
    try {
      console.log('🔄 Starting real-time polling for order:', orderId);
      const response = await api.post(`/orders/${orderId}/start-polling`);
      console.log('✅ Order polling started:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Failed to start order polling:', error);
      throw error;
    }
  },
  
  stopOrderPolling: async (orderId) => {
    try {
      console.log('⏹️ Stopping real-time polling for order:', orderId);
      const response = await api.post(`/orders/${orderId}/stop-polling`);
      console.log('✅ Order polling stopped:', response.data);
      return response;
    } catch (error) {
      console.error('❌ Failed to stop order polling:', error);
      throw error;
    }
  },
  
  getPollingStatus: () => api.get('/orders/polling/status'),
};

// Subscription API
export const subscriptionAPI = {
  getPlans: () => api.get('/subscription/plans'),
  getCurrentSubscription: () => api.get('/subscription/current'),
  subscribe: (planId) => api.post('/subscription/subscribe', { planId }),
  cancelSubscription: () => api.post('/subscription/cancel'),
  renewSubscription: (planId) => api.post('/subscription/renew', { planId }),
  getUsage: () => api.get('/subscription/usage'),
};

// Webhook API - Updated for Node.js Express endpoints
export const webhookAPI = {
  getLogs: (userId, params) => api.get(`/webhook/logs/${userId}`, { params }),
  testWebhook: (userId, webhookId) => api.post(`/webhook/test/${userId}/${webhookId}`),
};

// Symbols API - For symbol search and mapping
export const symbolsAPI = {
  // Get sync status for all brokers
  getSyncStatus: () => api.get('/symbols/sync-status'),
  
  // Get all symbols with filters
  getSymbols: (params = {}) => api.get('/symbols', { params }),
  
  // Sync symbols for all brokers
  syncAllSymbols: () => api.post('/symbols/sync-all'),
  
  // Sync symbols for specific broker (alias for syncBrokerSymbols)
  syncSymbols: (broker) => api.post(`/symbols/sync/${broker}`),
  
  // Sync symbols for specific broker
  syncBrokerSymbols: (broker) => api.post(`/symbols/sync/${broker}`),
  
  // Search symbols
  searchSymbols: (query, exchange = null, limit = 50) => 
    api.get('/symbols/search', { params: { q: query, exchange, limit } }),
  
  // Enhanced symbol search with advanced options
  enhancedSymbolSearch: (query, options = {}) => 
    api.get('/symbols/search/enhanced', { 
      params: { q: query, ...options } 
    }),

  // Search symbols by segment (segment-specific search)
  searchSymbolsBySegment: (query, segment, options = {}) =>
    api.get('/symbols/search/segment', {
      params: { q: query, segment, ...options }
    }),

  // Get available segments
  getAvailableSegments: () => api.get('/symbols/segments'),
  
  // Get broker-specific symbol mapping
  getBrokerMapping: (broker, symbol, exchange) => 
    api.get(`/symbols/mapping/${broker}/${symbol}/${exchange}`),
  
  // Get symbol details with all broker mappings
  getSymbolDetails: (symbol, exchange) => 
    api.get(`/symbols/details/${symbol}/${exchange}`),
  
  // Get symbols by exchange
  getSymbolsByExchange: (exchange, limit = 100) =>
    api.get(`/symbols/exchange/${exchange}`, { params: { limit } }),
  
  // Get popular symbols
  getPopularSymbols: (limit = 20) =>
    api.get('/symbols/popular', { params: { limit } }),
  
  // Get available exchanges
  getExchanges: () => api.get('/symbols/exchanges'),
  
  // Get symbol files information
  getSymbolFiles: () => api.get('/symbols/files'),
  
  // Download symbol file
  downloadSymbolFile: (broker, type, date = 'latest') =>
    api.get(`/symbols/download/${broker}/${type}`, { 
      params: { date },
      responseType: 'blob'
    }),
  
  // Generate webhook payload for specific symbol and broker
  generateWebhookPayload: (data) => api.post('/symbols/webhook/generate', data),
  
  // Validate symbol for broker compatibility
  validateSymbol: (data) => api.post('/symbols/validate', data),
  
  // Get webhook mapping for symbol
  getWebhookMapping: (broker, symbol, exchange) => 
    api.get(`/symbols/webhook-mapping/${broker}/${symbol}/${exchange}`),
  
  // Force sync for specific broker
  forceSyncBroker: (broker) => api.post(`/symbols/force-sync/${broker}`),
  
  // Get cached instruments for broker
  getCachedInstruments: (broker, limit = 100) => 
    api.get(`/symbols/cache/${broker}`, { params: { limit } }),
};

export default api;
