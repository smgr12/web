import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './database/init.js';
import { requestLoggingMiddleware, createLogger } from './utils/logger.js';
import authRoutes from './routes/auth.js';
import brokerRoutes from './routes/broker.js';
import ordersRoutes from './routes/orders.js';
import webhookRoutes from './routes/webhook.js';
import symbolsRoutes from './routes/symbols.js';
import subscriptionRoutes from './routes/subscription.js';
import orderStatusService from './services/orderStatusService.js';
import symbolSyncService from './services/symbolSyncService.js';

const app = express();
const PORT = process.env.PORT || 3001;
const logger = createLogger('SERVER');

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS ? JSON.parse(process.env.CORS_ORIGINS) : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLoggingMiddleware);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/symbols', symbolsRoutes);
app.use('/api/subscription', subscriptionRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize database and start server
async function startServer() {
  try {
    logger.info('Initializing database...');
    await initDatabase();
    
    logger.info('Starting order status service...');
    await orderStatusService.startPollingForOpenOrders();
    
    logger.info('Initializing symbol sync service...');
    // Automatic sync disabled - use manual sync from dashboard
    // const syncStatuses = await symbolSyncService.getSyncStatus();
    // const needsInitialSync = syncStatuses.length === 0 || 
    //   syncStatuses.some(s => s.sync_status !== 'completed');
    // 
    // if (needsInitialSync) {
    //   logger.info('Starting initial symbol sync...');
    //   symbolSyncService.syncAllBrokers().catch(error => {
    //     logger.error('Initial symbol sync failed:', error);
    //   });
    // }
    
    app.listen(PORT, () => {
      logger.info(`🚀 AutoTraderHub API Server running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/api/health`);
      logger.info(`🔗 CORS enabled for: ${JSON.stringify(process.env.CORS_ORIGINS || ['localhost:3000', 'localhost:5173'])}`);
      logger.info(`⏰ Symbol sync available via dashboard (manual trigger only)`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  orderStatusService.stopAllPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  orderStatusService.stopAllPolling();
  process.exit(0);
});

startServer();