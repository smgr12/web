import express from 'express';
import { db } from '../database/init.js';
import { authenticateToken } from '../middleware/auth.js';
import { encryptData, decryptData } from '../utils/encryption.js';
import kiteService from '../services/kiteService.js';
import upstoxService from '../services/upstoxService.js';
import angelService from '../services/angelService.js';
import shoonyaService from '../services/shoonyaService.js';
import mtSocketService from '../services/mtSocketService.js';
import brokerConfigService from '../services/brokerConfigService.js';
import { createLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const logger = createLogger('BROKER_API');

// Get all broker connections for a user
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const connections = await db.allAsync(
      `SELECT 
        id, broker_name, connection_name, api_key, user_id_broker, vendor_code, 
        is_active, is_authenticated, auth_method, webhook_url, created_at, last_sync,
        access_token_expires_at,
        CASE 
          WHEN access_token_expires_at IS NOT NULL AND access_token_expires_at < ? THEN 1 
          ELSE 0 
        END as token_expired,
        CASE 
          WHEN access_token_expires_at IS NOT NULL AND access_token_expires_at < ? THEN 1 
          ELSE 0 
        END as needs_token_refresh
      FROM broker_connections 
      WHERE user_id = ? 
      ORDER BY created_at DESC`,
      [
        Math.floor(Date.now() / 1000), // Current timestamp for token_expired
        Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now for needs_token_refresh
        req.user.id
      ]
    );

    res.json({ connections });
  } catch (error) {
    logger.error('Failed to fetch broker connections:', error);
    res.status(500).json({ error: 'Failed to fetch broker connections' });
  }
});

// Get specific broker connection
router.get('/connections/:id', authenticateToken, async (req, res) => {
  try {
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    res.json({ connection });
  } catch (error) {
    logger.error('Failed to fetch broker connection:', error);
    res.status(500).json({ error: 'Failed to fetch broker connection' });
  }
});

// Connect to a broker
router.post('/connect', authenticateToken, async (req, res) => {
  try {
    const { 
      brokerName, 
      connectionName, 
      apiKey, 
      apiSecret, 
      userId: userIdBroker, 
      vendorCode, 
      redirectUri,
      serverUrl,
      login,
      password,
      imei
    } = req.body;

    logger.info(`Broker connection request for ${brokerName}`, {
      userId: req.user.id,
      brokerName,
      connectionName,
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret,
      userIdBroker,
      vendorCode
    });

    // Validate broker configuration
    const validation = brokerConfigService.validateBrokerData(brokerName, req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid broker configuration', 
        details: validation.errors 
      });
    }

    // Generate webhook URL
    const webhookId = uuidv4();
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL || 'http://localhost:3001'}/api/webhook/${req.user.id}/${webhookId}`;

    // Encrypt sensitive data
    const encryptedApiKey = encryptData(apiKey);
    const encryptedApiSecret = apiSecret ? encryptData(apiSecret) : null;
    const encryptedPassword = password ? encryptData(password) : null;

    // Insert broker connection
    const result = await db.runAsync(
      `INSERT INTO broker_connections (
        user_id, broker_name, connection_name, api_key, encrypted_api_secret, 
        user_id_broker, vendor_code, redirect_uri, encrypted_password, imei,
        webhook_url, is_active, auth_method, broker_specific_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        brokerName.toLowerCase(),
        connectionName || `${brokerName} Connection`,
        encryptedApiKey,
        encryptedApiSecret,
        userIdBroker,
        vendorCode,
        redirectUri,
        encryptedPassword,
        imei,
        webhookUrl,
        1,
        ['mt4', 'mt5'].includes(brokerName.toLowerCase()) ? 'manual' : 
        ['zerodha', 'upstox', '5paisa'].includes(brokerName.toLowerCase()) ? 'oauth' : 'manual',
        JSON.stringify({ serverUrl, login })
      ]
    );

    const connectionId = result.lastID;

    // Handle different broker authentication flows
    let authResponse = {};

    try {
      if (brokerName.toLowerCase() === 'zerodha') {
        // Generate Zerodha login URL
        const loginUrl = `https://kite.trade/connect/login?api_key=${apiKey}&v=3`;
        authResponse = { 
          requiresAuth: true, 
          loginUrl,
          message: 'Please complete OAuth authentication'
        };
      } else if (brokerName.toLowerCase() === 'upstox') {
        // Generate Upstox login URL
        const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${connectionId}`;
        authResponse = { 
          requiresAuth: true, 
          loginUrl,
          message: 'Please complete OAuth authentication'
        };
      } else if (['mt4', 'mt5'].includes(brokerName.toLowerCase())) {
        // For MT4/MT5, generate access token immediately
        if (serverUrl && login && password) {
          const tokenData = await mtSocketService.generateAccessToken(
            apiKey, 
            apiSecret, 
            serverUrl, 
            login, 
            password
          );
          
          const encryptedAccessToken = encryptData(tokenData.access_token);
          const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);
          
          await db.runAsync(
            `UPDATE broker_connections 
             SET access_token = ?, access_token_expires_at = ?, is_authenticated = 1 
             WHERE id = ?`,
            [encryptedAccessToken, expiresAt, connectionId]
          );
          
          authResponse = { 
            requiresAuth: false,
            message: 'MT connection established successfully'
          };
        } else {
          authResponse = { 
            requiresAuth: true,
            message: 'Server URL, login, and password are required for MT platforms'
          };
        }
      } else {
        // For manual auth brokers (Angel, Shoonya), mark as requiring manual authentication
        authResponse = { 
          requiresAuth: true,
          message: `Please complete manual authentication for ${brokerName}`
        };
      }
    } catch (authError) {
      logger.error('Authentication setup failed:', authError);
      authResponse = { 
        requiresAuth: true,
        error: authError.message,
        message: 'Authentication setup failed, please try manual authentication'
      };
    }

    logger.info(`Broker connection created successfully`, {
      connectionId,
      brokerName,
      requiresAuth: authResponse.requiresAuth
    });

    res.status(201).json({
      message: 'Broker connection created successfully',
      connectionId,
      webhookUrl,
      ...authResponse
    });

  } catch (error) {
    logger.error('Failed to create broker connection:', error);
    res.status(500).json({ 
      error: 'Failed to create broker connection',
      details: error.message 
    });
  }
});

// Complete OAuth authentication (Zerodha)
router.post('/auth/zerodha/complete/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { requestToken } = req.body;

    logger.info(`Completing Zerodha OAuth for connection ${connectionId}`);

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const apiKey = decryptData(connection.api_key);
    const apiSecret = decryptData(connection.encrypted_api_secret);

    // Generate access token
    const session = await kiteService.generateAccessToken(apiKey, apiSecret, requestToken);

    // Store encrypted access token
    const encryptedAccessToken = encryptData(session.access_token);
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours

    await db.runAsync(
      `UPDATE broker_connections 
       SET access_token = ?, access_token_expires_at = ?, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [encryptedAccessToken, expiresAt, connectionId]
    );

    logger.info(`Zerodha authentication completed for connection ${connectionId}`);

    res.json({
      message: 'Zerodha authentication completed successfully',
      user_id: session.user_id
    });

  } catch (error) {
    logger.error('Zerodha OAuth completion failed:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Complete OAuth authentication (Upstox)
router.post('/auth/upstox/complete/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { authorizationCode } = req.body;

    logger.info(`Completing Upstox OAuth for connection ${connectionId}`);

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const apiKey = decryptData(connection.api_key);
    const apiSecret = decryptData(connection.encrypted_api_secret);

    // Generate access token
    const tokenData = await upstoxService.generateAccessToken(
      apiKey, 
      apiSecret, 
      authorizationCode, 
      connection.redirect_uri
    );

    // Store encrypted tokens
    const encryptedAccessToken = encryptData(tokenData.access_token);
    const encryptedRefreshToken = tokenData.refresh_token ? encryptData(tokenData.refresh_token) : null;
    const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);

    await db.runAsync(
      `UPDATE broker_connections 
       SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [encryptedAccessToken, encryptedRefreshToken, expiresAt, connectionId]
    );

    logger.info(`Upstox authentication completed for connection ${connectionId}`);

    res.json({
      message: 'Upstox authentication completed successfully'
    });

  } catch (error) {
    logger.error('Upstox OAuth completion failed:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Reconnect using stored credentials
router.post('/reconnect/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    logger.info(`Attempting to reconnect connection ${connectionId}`);

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const brokerName = connection.broker_name.toLowerCase();

    // Handle reconnection based on broker type
    if (brokerName === 'zerodha') {
      // For Zerodha, redirect to OAuth
      const apiKey = decryptData(connection.api_key);
      const loginUrl = `https://kite.trade/connect/login?api_key=${apiKey}&v=3`;
      
      res.json({
        requiresAuth: true,
        loginUrl,
        message: 'Please complete OAuth authentication'
      });
    } else if (brokerName === 'upstox') {
      // For Upstox, try refresh token first, then OAuth
      if (connection.refresh_token) {
        try {
          const tokenData = await upstoxService.refreshAccessToken(connectionId);
          
          const encryptedAccessToken = encryptData(tokenData.access_token);
          const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);
          
          await db.runAsync(
            `UPDATE broker_connections 
             SET access_token = ?, access_token_expires_at = ?, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [encryptedAccessToken, expiresAt, connectionId]
          );
          
          res.json({
            requiresAuth: false,
            message: 'Upstox connection refreshed successfully'
          });
        } catch (refreshError) {
          // Fallback to OAuth
          const apiKey = decryptData(connection.api_key);
          const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${encodeURIComponent(connection.redirect_uri)}&state=${connectionId}`;
          
          res.json({
            requiresAuth: true,
            loginUrl,
            message: 'Token refresh failed, please complete OAuth authentication'
          });
        }
      } else {
        // No refresh token, use OAuth
        const apiKey = decryptData(connection.api_key);
        const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${encodeURIComponent(connection.redirect_uri)}&state=${connectionId}`;
        
        res.json({
          requiresAuth: true,
          loginUrl,
          message: 'Please complete OAuth authentication'
        });
      }
    } else if (['mt4', 'mt5'].includes(brokerName)) {
      // For MT4/MT5, regenerate access token
      try {
        const apiKey = decryptData(connection.api_key);
        const apiSecret = decryptData(connection.encrypted_api_secret);
        const brokerData = JSON.parse(connection.broker_specific_data || '{}');
        const password = connection.encrypted_password ? decryptData(connection.encrypted_password) : null;
        
        if (!brokerData.serverUrl || !brokerData.login || !password) {
          return res.status(400).json({ 
            error: 'Missing MT connection details',
            message: 'Server URL, login, and password are required'
          });
        }
        
        const tokenData = await mtSocketService.generateAccessToken(
          apiKey,
          apiSecret,
          brokerData.serverUrl,
          brokerData.login,
          password
        );
        
        const encryptedAccessToken = encryptData(tokenData.access_token);
        const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);
        
        await db.runAsync(
          `UPDATE broker_connections 
           SET access_token = ?, access_token_expires_at = ?, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [encryptedAccessToken, expiresAt, connectionId]
        );
        
        res.json({
          requiresAuth: false,
          message: `${brokerName.toUpperCase()} connection refreshed successfully`
        });
      } catch (mtError) {
        logger.error(`${brokerName.toUpperCase()} reconnection failed:`, mtError);
        res.status(500).json({
          error: `${brokerName.toUpperCase()} reconnection failed`,
          details: mtError.message
        });
      }
    } else {
      // For manual auth brokers, return success (they need manual re-auth)
      res.json({
        requiresAuth: true,
        message: `Please complete manual authentication for ${connection.broker_name}`
      });
    }

  } catch (error) {
    logger.error('Reconnection failed:', error);
    res.status(500).json({ 
      error: 'Reconnection failed',
      details: error.message 
    });
  }
});

// Test broker connection
router.post('/test/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    let testResult;
    const brokerName = connection.broker_name.toLowerCase();

    switch (brokerName) {
      case 'zerodha':
        testResult = await kiteService.testConnection(connectionId);
        break;
      case 'upstox':
        testResult = await upstoxService.getProfile(connectionId);
        break;
      case 'angel':
        testResult = await angelService.getProfile(connectionId);
        break;
      case 'shoonya':
        testResult = await shoonyaService.getProfile(connectionId);
        break;
      case 'mt4':
      case 'mt5':
        testResult = await mtSocketService.getAccountInfo(connectionId);
        break;
      default:
        throw new Error(`Testing not implemented for ${brokerName}`);
    }

    res.json({
      success: true,
      message: 'Connection test successful',
      data: testResult
    });

  } catch (error) {
    logger.error('Connection test failed:', error);
    res.status(500).json({ 
      error: 'Connection test failed',
      details: error.message 
    });
  }
});

// Get positions from broker
router.get('/positions/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    let positions;
    const brokerName = connection.broker_name.toLowerCase();

    switch (brokerName) {
      case 'zerodha':
        positions = await kiteService.getPositions(connectionId);
        break;
      case 'upstox':
        positions = await upstoxService.getPositions(connectionId);
        break;
      case 'angel':
        positions = await angelService.getPositions(connectionId);
        break;
      case 'shoonya':
        positions = await shoonyaService.getPositions(connectionId);
        break;
      case 'mt4':
      case 'mt5':
        positions = await mtSocketService.getPositions(connectionId);
        break;
      default:
        throw new Error(`Positions not implemented for ${brokerName}`);
    }

    res.json({
      positions: positions.net || positions.positions || positions,
      broker_name: connection.broker_name,
      last_updated: new Date().toISOString(),
      connection_id: connectionId
    });

  } catch (error) {
    logger.error('Failed to fetch positions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch positions',
      details: error.message 
    });
  }
});

// Get holdings from broker
router.get('/holdings/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    let holdings;
    const brokerName = connection.broker_name.toLowerCase();

    switch (brokerName) {
      case 'zerodha':
        holdings = await kiteService.getHoldings(connectionId);
        break;
      case 'upstox':
        holdings = await upstoxService.getHoldings(connectionId);
        break;
      case 'angel':
        holdings = await angelService.getHoldings(connectionId);
        break;
      case 'shoonya':
        holdings = await shoonyaService.getHoldings(connectionId);
        break;
      case 'mt4':
      case 'mt5':
        // MT platforms don't have holdings concept, return empty array
        holdings = [];
        break;
      default:
        throw new Error(`Holdings not implemented for ${brokerName}`);
    }

    res.json({
      holdings: holdings.holdings || holdings || [],
      broker_name: connection.broker_name,
      last_updated: new Date().toISOString(),
      connection_id: connectionId
    });

  } catch (error) {
    logger.error('Failed to fetch holdings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch holdings',
      details: error.message 
    });
  }
});

// Delete broker connection
router.delete('/connections/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Clear cached instances
    const brokerName = connection.broker_name.toLowerCase();
    switch (brokerName) {
      case 'zerodha':
        kiteService.clearCachedInstance(connectionId);
        break;
      case 'upstox':
        upstoxService.clearCachedInstance(connectionId);
        break;
      case 'angel':
        angelService.clearCachedInstance(connectionId);
        break;
      case 'shoonya':
        shoonyaService.clearCachedInstance(connectionId);
        break;
      case 'mt4':
      case 'mt5':
        mtSocketService.clearCachedInstance(connectionId);
        break;
    }

    // Delete from database
    await db.runAsync(
      'DELETE FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    logger.info(`Broker connection ${connectionId} deleted successfully`);

    res.json({ message: 'Broker connection deleted successfully' });

  } catch (error) {
    logger.error('Failed to delete broker connection:', error);
    res.status(500).json({ 
      error: 'Failed to delete broker connection',
      details: error.message 
    });
  }
});

export default router;