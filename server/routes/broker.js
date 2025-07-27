import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/init.js';
import { authenticateToken } from '../middleware/auth.js';
import { encryptData, decryptData, testEncryption } from '../utils/encryption.js';
import kiteService from '../services/kiteService.js';
import upstoxService, { checkUpstoxApiStatus } from '../services/upstoxService.js';
import angelService from '../services/angelService.js';
import shoonyaService from '../services/shoonyaService.js';
import brokerConfigService from '../services/brokerConfigService.js';
import createLogger from '../utils/logger.js';
import BrokerAuthDiagnostics from '../utils/brokerAuthDiagnostics.js';

const logger = createLogger('BrokerHandler');

const router = express.Router();

// Test encryption on startup
testEncryption();

// Utility function to validate token and handle expiration
const validateTokenAndHandleExpiration = async (connection, res, logger) => {
  const now = Math.floor(Date.now() / 1000);
  
  if (!connection.access_token) {
    logger.warn(`No access token found for connection ${connection.id}`);
    return {
      valid: false,
      response: res.status(401).json({ 
        error: 'No access token found. Please authenticate first.',
        needsAuth: true,
        connectionId: connection.id
      })
    };
  }

  if (connection.access_token_expires_at && connection.access_token_expires_at < now) {
    logger.warn(`Access token expired for connection ${connection.id}`);
    
    // Mark connection as needing authentication
    try {
      await db.runAsync(
        'UPDATE broker_connections SET is_authenticated = 0 WHERE id = ?',
        [connection.id]
      );
    } catch (dbError) {
      logger.error('Failed to update connection authentication status:', dbError);
    }
    
    return {
      valid: false,
      response: res.status(401).json({ 
        error: 'Access token has expired. Please reconnect your account.',
        tokenExpired: true,
        connectionId: connection.id
      })
    };
  }

  // Check if token expires soon (within 1 hour) and warn
  const tokenExpiresIn = connection.access_token_expires_at - now;
  if (connection.access_token_expires_at && tokenExpiresIn < 3600 && tokenExpiresIn > 0) {
    logger.warn(`Token expires soon for connection ${connection.id}: ${Math.floor(tokenExpiresIn / 60)} minutes remaining`);
  }

  return { valid: true };
};

// Batch health check for all connections
router.get('/connections/health', authenticateToken, async (req, res) => {
  try {
    const connections = await db.allAsync(`
      SELECT 
        id, broker_name, connection_name, is_active, 
        access_token_expires_at, is_authenticated,
        CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END as has_token
      FROM broker_connections 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [req.user.id]);

    const now = Math.floor(Date.now() / 1000);
    const healthStatuses = [];

    for (const connection of connections) {
      const tokenExpired = connection.access_token_expires_at && connection.access_token_expires_at < now;
      const tokenExpiresIn = connection.access_token_expires_at ? connection.access_token_expires_at - now : null;
      
      let healthStatus = 'healthy';
      let issues = [];

      if (!connection.is_active) {
        healthStatus = 'inactive';
        issues.push('Connection is inactive');
      } else if (!connection.has_token) {
        healthStatus = 'needs_auth';
        issues.push('Missing access token');
      } else if (tokenExpired) {
        healthStatus = 'token_expired';
        issues.push('Access token has expired');
      } else if (tokenExpiresIn && tokenExpiresIn < 3600) {
        healthStatus = 'warning';
        issues.push(`Token expires in ${Math.floor(tokenExpiresIn / 60)} minutes`);
      }

      healthStatuses.push({
        connectionId: connection.id,
        brokerName: connection.broker_name,
        connectionName: connection.connection_name,
        healthStatus,
        issues,
        tokenExpired,
        tokenExpiresIn
      });
    }

    const summary = {
      total: healthStatuses.length,
      healthy: healthStatuses.filter(h => h.healthStatus === 'healthy').length,
      warning: healthStatuses.filter(h => h.healthStatus === 'warning').length,
      needsAuth: healthStatuses.filter(h => h.healthStatus === 'needs_auth').length,
      tokenExpired: healthStatuses.filter(h => h.healthStatus === 'token_expired').length,
      inactive: healthStatuses.filter(h => h.healthStatus === 'inactive').length
    };

    res.json({
      summary,
      connections: healthStatuses,
      lastChecked: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Batch health check error:', error);
    res.status(500).json({ error: 'Failed to check connections health' });
  }
});

// Get broker connections with enhanced data
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const connections = await db.allAsync(`
      SELECT 
        id, broker_name, connection_name, is_active, created_at, last_sync, webhook_url,
        access_token_expires_at,
        CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END as is_authenticated
      FROM broker_connections 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [req.user.id]);

    // Check if access tokens are expired and mark them
    const now = Math.floor(Date.now() / 1000);
    const enhancedConnections = connections.map(conn => ({
      ...conn,
      token_expired: conn.access_token_expires_at && conn.access_token_expires_at < now,
      needs_token_refresh: conn.access_token_expires_at && (conn.access_token_expires_at - now) < 3600 // Less than 1 hour
    }));

    res.json({ connections: enhancedConnections });
  } catch (error) {
    logger.error('Get connections error:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Check connection health and authentication status
router.get('/connections/:id/health', authenticateToken, async (req, res) => {
  try {
    const connection = await db.getAsync(`
      SELECT 
        id, broker_name, connection_name, is_active, 
        access_token_expires_at, is_authenticated,
        CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END as has_token
      FROM broker_connections 
      WHERE id = ? AND user_id = ?
    `, [req.params.id, req.user.id]);

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenExpired = connection.access_token_expires_at && connection.access_token_expires_at < now;
    const tokenExpiresIn = connection.access_token_expires_at ? connection.access_token_expires_at - now : null;
    
    let healthStatus = 'healthy';
    let issues = [];

    if (!connection.is_active) {
      healthStatus = 'inactive';
      issues.push('Connection is inactive');
    }

    if (!connection.has_token) {
      healthStatus = 'needs_auth';
      issues.push('Missing access token');
    } else if (tokenExpired) {
      healthStatus = 'token_expired';
      issues.push('Access token has expired');
    } else if (tokenExpiresIn && tokenExpiresIn < 3600) {
      healthStatus = 'warning';
      issues.push(`Token expires in ${Math.floor(tokenExpiresIn / 60)} minutes`);
    }

    // Test broker connection if healthy
    let brokerConnected = false;
    if (healthStatus === 'healthy' || healthStatus === 'warning') {
      try {
        if (connection.broker_name.toLowerCase() === 'zerodha') {
          await kiteService.getProfile(connection.id);
          brokerConnected = true;
        } else if (connection.broker_name.toLowerCase() === 'upstox') {
          await upstoxService.getProfile(connection.id);
          brokerConnected = true;
        }
        // Add other brokers as needed
      } catch (testError) {
        logger.warn(`Broker connection test failed for ${connection.id}:`, testError.message);
        healthStatus = 'connection_failed';
        issues.push(`Broker API test failed: ${testError.message}`);
      }
    }

    res.json({
      connectionId: connection.id,
      brokerName: connection.broker_name,
      healthStatus,
      issues,
      brokerConnected,
      tokenExpired,
      tokenExpiresIn,
      lastChecked: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({ error: 'Failed to check connection health' });
  }
});

// Get specific broker connection details
router.get('/connections/:id', authenticateToken, async (req, res) => {
  try {
    const connection = await db.getAsync(`
      SELECT 
        id, broker_name, connection_name, is_active, created_at, last_sync, webhook_url,
        user_id_broker, vendor_code, imei, api_key, access_token_expires_at,
        CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END as is_authenticated
      FROM broker_connections 
      WHERE id = ? AND user_id = ?
    `, [req.params.id, req.user.id]);

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    const now = Math.floor(Date.now() / 1000);
    connection.token_expired = connection.access_token_expires_at && connection.access_token_expires_at < now;
    connection.needs_token_refresh = connection.access_token_expires_at && (connection.access_token_expires_at - now) < 3600;

    // For Shoonya connections, decrypt the API key for display
    if (connection.broker_name.toLowerCase() === 'shoonya' && connection.api_key) {
      try {
        connection.api_key = decryptData(connection.api_key);
      } catch (decryptError) {
        logger.warn('Failed to decrypt API key for connection details:', decryptError);
        connection.api_key = null;
      }
    }

    res.json({ connection });
  } catch (error) {
    logger.error('Get connection details error:', error);
    res.status(500).json({ error: 'Failed to fetch connection details' });
  }
});

// Get real-time positions from broker
router.get('/positions/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info(`Fetching real-time positions for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let positions = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'zerodha') {
        const positionsData = await kiteService.getPositions(connectionId);
        
        // Format positions data
        if (positionsData && positionsData.net) {
          positions = positionsData.net
            .filter(pos => Math.abs(pos.quantity) > 0) // Only non-zero positions
            .map(pos => ({
              tradingsymbol: pos.tradingsymbol,
              exchange: pos.exchange,
              instrument_token: pos.instrument_token,
              product: pos.product,
              quantity: pos.quantity,
              overnight_quantity: pos.overnight_quantity,
              multiplier: pos.multiplier,
              average_price: pos.average_price,
              close_price: pos.close_price,
              last_price: pos.last_price,
              value: pos.value,
              pnl: pos.pnl,
              m2m: pos.m2m,
              unrealised: pos.unrealised,
              realised: pos.realised,
              buy_quantity: pos.buy_quantity,
              buy_price: pos.buy_price,
              buy_value: pos.buy_value,
              sell_quantity: pos.sell_quantity,
              sell_price: pos.sell_price,
              sell_value: pos.sell_value,
              day_buy_quantity: pos.day_buy_quantity,
              day_buy_price: pos.day_buy_price,
              day_buy_value: pos.day_buy_value,
              day_sell_quantity: pos.day_sell_quantity,
              day_sell_price: pos.day_sell_price,
              day_sell_value: pos.day_sell_value
            }));
        }
      } else if (connection.broker_name.toLowerCase() === 'upstox') {
        const positionsData = await upstoxService.getPositions(connectionId);
        
        // Format Upstox positions data
        if (positionsData && Array.isArray(positionsData)) {
          positions = positionsData
            .filter(pos => Math.abs(pos.quantity || 0) > 0) // Only non-zero positions
            .map(pos => ({
              tradingsymbol: pos.instrument_token, // Upstox uses instrument_token
              exchange: pos.exchange,
              instrument_token: pos.instrument_token,
              product: pos.product,
              quantity: pos.quantity || 0,
              average_price: pos.average_price || 0,
              last_price: pos.last_price || 0,
              pnl: pos.unrealised_pnl || 0,
              unrealised: pos.unrealised_pnl || 0,
              realised: pos.realised_pnl || 0,
              value: (pos.quantity || 0) * (pos.last_price || 0)
            }));
        }
      } else if (connection.broker_name.toLowerCase() === 'shoonya') {
        const positionsData = await shoonyaService.getPositions(connectionId);
        
        // Format Shoonya positions data
        if (positionsData && positionsData.positions && Array.isArray(positionsData.positions)) {
          positions = positionsData.positions
            .filter(pos => Math.abs(pos.netqty || 0) > 0) // Only non-zero positions
            .map(pos => ({
              tradingsymbol: pos.tsym,
              exchange: pos.exch,
              instrument_token: pos.token,
              product: pos.prd,
              quantity: parseInt(pos.netqty || 0),
              average_price: parseFloat(pos.netavgprc || 0),
              last_price: parseFloat(pos.lp || 0),
              pnl: parseFloat(pos.rpnl || 0) + parseFloat(pos.urmtom || 0),
              unrealised: parseFloat(pos.urmtom || 0),
              realised: parseFloat(pos.rpnl || 0),
              value: parseFloat(pos.netqty || 0) * parseFloat(pos.lp || 0),
              buy_quantity: parseInt(pos.daybuyqty || 0),
              sell_quantity: parseInt(pos.daysellqty || 0),
              multiplier: parseInt(pos.mult || 1)
            }));
        }
      } else if (connection.broker_name.toLowerCase() === 'angel') {
        const positionsData = await angelService.getPositions(connectionId);
        
        // Format Angel positions data
        if (positionsData && positionsData.data && Array.isArray(positionsData.data)) {
          positions = positionsData.data
            .filter(pos => Math.abs(pos.netqty || 0) > 0) // Only non-zero positions
            .map(pos => ({
              tradingsymbol: pos.tradingsymbol,
              exchange: pos.exchange,
              instrument_token: pos.symboltoken,
              product: pos.producttype,
              quantity: parseInt(pos.netqty || 0),
              average_price: parseFloat(pos.avgnetprice || 0),
              last_price: parseFloat(pos.ltp || 0),
              pnl: parseFloat(pos.pnl || 0),
              unrealised: parseFloat(pos.unrealised || 0),
              realised: parseFloat(pos.realised || 0),
              value: parseFloat(pos.netvalue || 0)
            }));
        }
      } else {
        // For other brokers, implement their specific position fetching
        logger.warn(`Real-time positions not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Real-time positions not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved ${positions.length} positions for connection ${connectionId}`);
      
      res.json({
        positions,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch positions from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch positions from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get positions error:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Get real-time holdings from broker
router.get('/holdings/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info(`Fetching real-time holdings for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let holdings = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'zerodha') {
        const holdingsData = await kiteService.getHoldings(connectionId);
        
        // Format holdings data
        if (holdingsData && Array.isArray(holdingsData)) {
          holdings = holdingsData
            .filter(holding => holding.quantity > 0) // Only positive holdings
            .map(holding => ({
              tradingsymbol: holding.tradingsymbol,
              exchange: holding.exchange,
              instrument_token: holding.instrument_token,
              isin: holding.isin,
              product: holding.product,
              price: holding.price,
              quantity: holding.quantity,
              used_quantity: holding.used_quantity,
              t1_quantity: holding.t1_quantity,
              realised_quantity: holding.realised_quantity,
              authorised_quantity: holding.authorised_quantity,
              authorised_date: holding.authorised_date,
              opening_quantity: holding.opening_quantity,
              collateral_quantity: holding.collateral_quantity,
              collateral_type: holding.collateral_type,
              discrepancy: holding.discrepancy,
              average_price: holding.average_price,
              last_price: holding.last_price,
              close_price: holding.close_price,
              pnl: holding.pnl,
              day_change: holding.day_change,
              day_change_percentage: holding.day_change_percentage
            }));
        }
      } else if (connection.broker_name.toLowerCase() === 'upstox') {
        const holdingsData = await upstoxService.getHoldings(connectionId);
        
        // Format Upstox holdings data
        if (holdingsData && Array.isArray(holdingsData)) {
          holdings = holdingsData
            .filter(holding => (holding.quantity || 0) > 0) // Only positive holdings
            .map(holding => ({
              tradingsymbol: holding.instrument_token, // Upstox uses instrument_token
              exchange: holding.exchange,
              instrument_token: holding.instrument_token,
              quantity: holding.quantity || 0,
              average_price: holding.average_price || 0,
              last_price: holding.last_price || 0,
              pnl: holding.pnl || 0,
              day_change: holding.day_change || 0,
              day_change_percentage: holding.day_change_percentage || 0,
              used_quantity: holding.used_quantity || 0,
              collateral_quantity: holding.collateral_quantity || 0
            }));
        }
      } else if (connection.broker_name.toLowerCase() === 'shoonya') {
        const holdingsData = await shoonyaService.getHoldings(connectionId);
        
        // Format Shoonya holdings data
        if (holdingsData && holdingsData.holdings && Array.isArray(holdingsData.holdings)) {
          holdings = holdingsData.holdings
            .filter(holding => 
              parseInt(holding.holdqty || 0) > 0 || 
              parseInt(holding.npoadqty || 0) > 0 || 
              parseInt(holding.benqty || 0) > 0
            ) // Holdings with any positive quantity
            .map(holding => {
              // Get the first exchange info from exch_tsym array if available
              const exchInfo = holding.exch_tsym && holding.exch_tsym[0] ? holding.exch_tsym[0] : {};
              
              return {
                tradingsymbol: exchInfo.tsym || holding.tsym,
                exchange: exchInfo.exch || holding.exch,
                instrument_token: exchInfo.token || holding.token,
                isin: exchInfo.isin || holding.isin,
              product: holding.prd,
              price: parseFloat(holding.upldprc || 0),
              quantity: parseInt(holding.npoadqty || holding.holdqty || 0),
              used_quantity: parseInt(holding.usedqty || 0),
              collateral_quantity: parseInt(holding.brkcolqty || 0),
              average_price: parseFloat(holding.upldprc || 0),
              last_price: parseFloat(holding.lp || 0),
              close_price: parseFloat(holding.lp || 0),
              pnl: (parseInt(holding.npoadqty || holding.holdqty || 0) * (parseFloat(holding.lp || 0) - parseFloat(holding.upldprc || 0))),
                day_change: parseFloat(holding.lp || 0) - parseFloat(holding.upldprc || 0),
                day_change_percentage: parseFloat(holding.upldprc || 0) > 0 ? 
                  ((parseFloat(holding.lp || 0) - parseFloat(holding.upldprc || 0)) / parseFloat(holding.upldprc || 0)) * 100 : 0
              };
            });
        }
      } else if (connection.broker_name.toLowerCase() === 'angel') {
        const holdingsData = await angelService.getHoldings(connectionId);
        
        // Format Angel holdings data
        if (holdingsData && holdingsData.data && Array.isArray(holdingsData.data)) {
          holdings = holdingsData.data
            .filter(holding => parseInt(holding.quantity || 0) > 0) // Only positive holdings
            .map(holding => ({
              tradingsymbol: holding.tradingsymbol,
              exchange: holding.exchange,
              instrument_token: holding.symboltoken,
              isin: holding.isin,
              product: holding.producttype,
              price: parseFloat(holding.price || 0),
              quantity: parseInt(holding.quantity || 0),
              average_price: parseFloat(holding.averageprice || 0),
              last_price: parseFloat(holding.ltp || 0),
              close_price: parseFloat(holding.close || 0),
              pnl: parseFloat(holding.pnl || 0),
              day_change: parseFloat(holding.ltp || 0) - parseFloat(holding.close || 0),
              day_change_percentage: parseFloat(holding.close || 0) > 0 ? 
                ((parseFloat(holding.ltp || 0) - parseFloat(holding.close || 0)) / parseFloat(holding.close || 0)) * 100 : 0
            }));
        }
      } else {
        // For other brokers, implement their specific holdings fetching
        logger.warn(`Real-time holdings not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Real-time holdings not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved ${holdings.length} holdings for connection ${connectionId}`);
      
      res.json({
        holdings,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch holdings from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch holdings from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get holdings error:', error);
    res.status(500).json({ error: 'Failed to fetch holdings' });
  }
});

// Get broker connection information and available brokers
router.get('/connect', authenticateToken, async (req, res) => {
  try {
    // Return information about available brokers and connection limits
    const existingConnections = await db.allAsync(
      'SELECT COUNT(*) as count FROM broker_connections WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );

    const brokerConfigs = brokerConfigService.getAllBrokers();
    
    res.json({
      availableBrokers: brokerConfigs,
      connectionLimits: {
        maxConnections: 5,
        currentConnections: existingConnections[0].count
      },
      supportedBrokers: [
        'zerodha',
        'upstox', 
        'angel',
        'shoonya',
        '5paisa'
      ]
    });

  } catch (error) {
    logger.error('Get connect info error:', error);
    res.status(500).json({ error: 'Failed to fetch connection information' });
  }
});

// Get broker authentication URL (for OAuth brokers)
router.get('/connect/:connectionId/auth-url', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const state = JSON.stringify({ 
      connection_id: connectionId,
      user_id: req.user.id,
      reconnect: false 
    });
    
    let authUrl = '';
    
    if (connection.broker_name.toLowerCase() === 'zerodha') {
      const apiKey = decryptData(connection.api_key);
      const redirectUrl = `${baseUrl}/api/broker/auth/zerodha/callback`;
      authUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3&redirect_url=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
    } else if (connection.broker_name.toLowerCase() === 'upstox') {
      const apiKey = decryptData(connection.api_key);
      const redirectUrl = connection.redirect_uri || `${req.protocol}://${req.get('host')}/api/broker/auth/upstox/callback`;
      authUrl = `https://api.upstox.com/v2/login/authorization/dialog?client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
    } else {
      return res.status(400).json({ 
        error: `Authentication URL generation not supported for ${connection.broker_name}` 
      });
    }

    res.json({
      authUrl,
      connectionId,
      brokerName: connection.broker_name,
      redirectUrl: connection.redirect_uri || `${baseUrl}/api/broker/auth/${connection.broker_name.toLowerCase()}/callback`
    });

  } catch (error) {
    logger.error('Auth URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate authentication URL' });
  }
});

// Connect broker - Step 1: Store credentials and generate login URL
router.post('/connect', authenticateToken, async (req, res) => {
  try {
    const { 
      brokerName, 
      apiKey, 
      apiSecret, 
      clientCode,
      password,
      pin,
      twoFA,
      userId, 
      connectionName,
      vendorCode,
      imei,
      redirectUri,
      appKey
    } = req.body;

    // Get broker configuration
    const brokerConfig = brokerConfigService.getBrokerConfig(brokerName);
    
    // Validate required fields for initial connection
    const validation = brokerConfigService.validateBrokerData(brokerName, {
      api_key: apiKey,
      api_secret: apiSecret,
      client_code: clientCode,
      password: password,
      pin: pin,
      two_fa: twoFA,
      user_id_broker: userId,
      vendor_code: vendorCode,
      imei: imei,
      redirect_uri: redirectUri,
      app_key: appKey
    }, true); // Pass true for isInitialConnection

    if (!validation.isValid) {
      logger.warn('Broker connection validation failed:', {
        brokerName,
        validationErrors: validation.errors,
        submittedData: Object.keys(req.body)
      });
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.errors 
      });
    }

    logger.info('Broker connection request:', { brokerName, userId, connectionName });

    if (!brokerName || !apiKey) {
      return res.status(400).json({ error: 'Broker name and API key are required' });
    }

    // Check connection limit (max 5 per user)
    const existingConnections = await db.allAsync(
      'SELECT COUNT(*) as count FROM broker_connections WHERE user_id = ? AND is_active = 1',
      [req.user.id]
    );

    if (existingConnections[0].count >= 5) {
      return res.status(400).json({ error: 'Maximum 5 broker connections allowed per user' });
    }

    // Generate unique webhook URL for this connection
    const webhookId = uuidv4();
    const webhookUrl = brokerConfigService.getWebhookUrl(req.user.id, webhookId);

    logger.info('Generated webhook URL:', webhookUrl);

    // Generate connection name if not provided
    const finalConnectionName = connectionName || `${brokerName} Connection ${Date.now()}`;

    let connectionId;
    
    try {
      // Test encryption before storing
      const testEncrypted = encryptData('test');
      const testDecrypted = decryptData(testEncrypted);
      if (testDecrypted !== 'test') {
        throw new Error('Encryption test failed');
      }

      const encryptedApiKey = encryptData(apiKey);
      const encryptedApiSecret = apiSecret ? encryptData(apiSecret) : null;
      const encryptedClientCode = clientCode ? encryptData(clientCode) : null;
      const encryptedPassword = password ? encryptData(password) : null;
      const encryptedPin = pin ? encryptData(pin) : null;
      const encryptedTwoFA = twoFA ? encryptData(twoFA) : null;

      // Prepare broker-specific data
      const brokerSpecificData = {
        vendor_code: vendorCode,
        imei: imei,
        redirect_uri: redirectUri,
        app_key: appKey,
        auth_method: brokerConfig.authMethod
      };

      // Create new connection
      const result = await db.runAsync(`
        INSERT INTO broker_connections (
          user_id, broker_name, connection_name, api_key, encrypted_api_secret,
          encrypted_client_code, encrypted_password, encrypted_pin, encrypted_two_fa,
          user_id_broker, vendor_code, imei, redirect_uri, app_key,
          auth_method, broker_specific_data, webhook_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id,
        brokerName,
        finalConnectionName,
        encryptedApiKey,
        encryptedApiSecret,
        encryptedClientCode,
        encryptedPassword,
        encryptedPin,
        encryptedTwoFA,
        userId,
        vendorCode,
        imei,
        redirectUri,
        appKey,
        brokerConfig.authMethod,
        JSON.stringify(brokerSpecificData),
        webhookUrl
      ]);
      
      connectionId = result.lastID;
      logger.info('Created new broker connection:', connectionId);
    } catch (encryptionError) {
      logger.error('Encryption error:', encryptionError);
      return res.status(500).json({ error: 'Failed to encrypt credentials. Please try again.' });
    }

    // Handle different broker authentication flows based on auth method
    if (brokerConfig.authMethod === 'oauth') {
      // Generate OAuth URL with proper redirect and state parameters
      let authUrl;
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const state = JSON.stringify({ 
        connection_id: connectionId,
        user_id: req.user.id,
        reconnect: false 
      });
      
      if (brokerName.toLowerCase() === 'zerodha') {
        const redirectUrl = `${baseUrl}/api/broker/auth/zerodha/callback`;
        authUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3&redirect_url=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
        
        logger.info('Generated Zerodha login URL:', {
          connectionId,
          redirectUrl,
          state: state.substring(0, 50) + '...'
        });
      } else if (brokerName.toLowerCase() === 'upstox') {
        const redirectUrl = `${baseUrl}/api/broker/auth/upstox/callback`;
        authUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
      } else if (brokerName.toLowerCase() === '5paisa') {
        const redirectUrl = redirectUri || `${baseUrl}/api/broker/auth/5paisa/callback`;
        authUrl = `https://dev-openapi.5paisa.com/WebVendorLogin/VLogin/Index?VendorKey=${apiKey}&ResponseURL=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
      }
      
      res.json({
        success: true,
        message: 'Broker connection created. Please complete authentication.',
        connectionId,
        loginUrl: authUrl,
        webhookUrl,
        requiresAuth: true
      });
    } else if (brokerConfig.authMethod === 'manual') {
      // For manual authentication brokers (Angel, Shoonya)
      await db.runAsync(
        'UPDATE broker_connections SET is_authenticated = 0 WHERE id = ?',
        [connectionId]
      );
      
      // For Shoonya, always require manual authentication in second step
      // Data is already saved in DB above
      
      res.json({
        success: true,
        message: 'Broker connection created. Manual authentication required.',
        connectionId,
        webhookUrl,
        requiresAuth: true,
        authMethod: 'manual',
        authType: 'credentials'
      });
    }
  } catch (error) {
    logger.error('Connect broker error:', error);
    res.status(500).json({ error: 'Failed to connect broker. Please check your credentials and try again.' });
  }
});

// Reconnect using stored credentials - generates new access token directly
router.post('/reconnect/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info('Reconnecting using stored credentials for connection:', connectionId);
    console.log('🔌 Reconnecting broker connection:', connectionId);

    // Get connection details with encrypted credentials
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      logger.warn('Broker connection not found for reconnection', { connectionId, userId: req.user.id });
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    console.log('🔍 Found broker connection for reconnection:', {
      id: connection.id,
      broker_name: connection.broker_name,
      is_active: connection.is_active,
      is_authenticated: connection.is_authenticated,
      has_api_key: !!connection.api_key,
      has_api_secret: !!connection.encrypted_api_secret
    });

    // First, ensure the connection is marked as active
    console.log('🔄 Marking connection as active...');
    await db.runAsync(
      'UPDATE broker_connections SET is_active = 1, last_sync = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    // Check if we have the required credentials
    if (!connection.api_key) {
      logger.warn('Missing API key for reconnection', { connectionId });
      return res.status(400).json({
        error: 'Missing API key. Please update your connection settings.',
        needsCredentials: true
      });
    }

    // For OAuth brokers, also check for API secret
    if ((connection.broker_name.toLowerCase() === 'zerodha' || 
         connection.broker_name.toLowerCase() === 'upstox') && 
        !connection.encrypted_api_secret) {
      logger.warn('Missing API secret for OAuth broker reconnection', { 
        connectionId, 
        broker: connection.broker_name 
      });
      return res.status(400).json({
        error: 'Missing API secret. Please update your connection settings.',
        needsCredentials: true
      });
    }

    try {
      // Decrypt stored credentials
      console.log('🔐 Decrypting stored credentials...');
      const apiKey = decryptData(connection.api_key);
      let apiSecret = null;
      
      if (connection.encrypted_api_secret) {
        apiSecret = decryptData(connection.encrypted_api_secret);
      }
      
      logger.info('Using stored credentials to reconnect');

      // Clear any cached instances for this connection
      let cacheCleared = false;
      try {
        console.log('🗑️ Clearing any cached instances...');
        if (connection.broker_name.toLowerCase() === 'zerodha' && kiteService.clearCachedInstance) {
          cacheCleared = kiteService.clearCachedInstance(connectionId);
          console.log('🗑️ Zerodha cache cleared:', cacheCleared);
        } else if (connection.broker_name.toLowerCase() === 'upstox' && upstoxService.clearCachedInstance) {
          cacheCleared = upstoxService.clearCachedInstance(connectionId);
          console.log('🗑️ Upstox cache cleared:', cacheCleared);
        } else if (connection.broker_name.toLowerCase() === 'angel' && angelService.clearCachedInstance) {
          cacheCleared = angelService.clearCachedInstance(connectionId);
          console.log('🗑️ Angel cache cleared:', cacheCleared);
        } else if (connection.broker_name.toLowerCase() === 'shoonya' && shoonyaService.clearCachedInstance) {
          cacheCleared = shoonyaService.clearCachedInstance(connectionId);
          console.log('🗑️ Shoonya cache cleared:', cacheCleared);
        }
      } catch (clearError) {
        logger.warn(`Error clearing cached instance: ${clearError.message}`);
        console.error('❌ Error clearing cached instance:', clearError);
        // Continue with reconnection even if clearing cache fails
      }

      // Ensure any existing tokens are cleared from the database
      console.log('🔄 Clearing existing tokens from database...');
      await db.runAsync(
        `UPDATE broker_connections 
         SET access_token = NULL, 
             refresh_token = NULL, 
             feed_token = NULL,
             session_token = NULL,
             is_authenticated = 0
         WHERE id = ?`,
        [connectionId]
      );

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const state = JSON.stringify({ 
        connection_id: connectionId,
        user_id: req.user.id,
        reconnect: true 
      });

      console.log('🔄 Generating authentication URL for broker:', connection.broker_name.toLowerCase());
      
      if (connection.broker_name.toLowerCase() === 'zerodha') {
        const redirectUrl = `${baseUrl}/api/broker/auth/zerodha/callback`;
        const loginUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3&redirect_url=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;

        logger.info('Generated reconnection login URL for Zerodha connection:', connectionId);
        console.log('✅ Generated Zerodha login URL');

        res.json({
          message: 'Please complete authentication to reconnect your Zerodha account.',
          loginUrl,
          requiresAuth: true,
          reconnect: true,
          brokerName: 'Zerodha',
          connectionId,
          cacheCleared
        });
      } else if (connection.broker_name.toLowerCase() === 'upstox') {
        const redirectUrl = connection.redirect_uri || `${baseUrl}/api/broker/auth/upstox/callback`;
        const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;

        logger.info('Generated reconnection login URL for Upstox connection:', connectionId);
        console.log('✅ Generated Upstox login URL with redirect:', redirectUrl);

        res.json({
          message: 'Please complete authentication to reconnect your Upstox account.',
          loginUrl,
          requiresAuth: true,
          reconnect: true,
          brokerName: 'Upstox',
          connectionId,
          redirectUrl,
          cacheCleared
        });
      } else if (connection.broker_name.toLowerCase() === 'angel') {
        logger.info('Angel Broking reconnection requires manual authentication');
        console.log('✅ Angel Broking requires manual authentication');

        res.json({
          message: 'Please complete authentication to reconnect your Angel Broking account.',
          requiresAuth: true,
          authType: 'credentials',
          reconnect: true,
          brokerName: 'Angel Broking',
          connectionId,
          cacheCleared
        });
      } else if (connection.broker_name.toLowerCase() === 'shoonya') {
        logger.info('Shoonya reconnection requires manual authentication');
        console.log('✅ Shoonya requires manual authentication');

        // Extract stored credentials to simplify reconnection
        const userId = connection.user_id_broker;
        const vendorCode = connection.vendor_code;
        const imei = connection.imei || '';
        const storedApiKey = connection.api_key ? decryptData(connection.api_key) : '';
        const apiSecret = connection.encrypted_api_secret ? decryptData(connection.encrypted_api_secret) : '';

        res.json({
          message: 'Please complete authentication to reconnect your Shoonya account.',
          requiresAuth: true,
          authType: 'credentials',
          reconnect: true,
          brokerName: 'Shoonya',
          connectionId,
          cacheCleared,
          // Include stored credentials to simplify the reconnection form
          storedCredentials: {
            user_id_broker: userId,
            vendor_code: vendorCode,
            api_key: storedApiKey,
            imei: imei
          }
        });
      } else {
        logger.warn('Unsupported broker for reconnection', { broker: connection.broker_name });
        return res.status(400).json({
          error: 'Direct reconnection not supported for this broker. Please update your connection.',
          brokerName: connection.broker_name
        });
      }

    } catch (decryptError) {
      logger.error('Failed to decrypt stored credentials:', decryptError);
      console.error('❌ Failed to decrypt stored credentials:', decryptError);
      return res.status(500).json({
        error: 'Failed to decrypt stored credentials. Please update your connection settings.',
        needsCredentials: true
      });
    }

  } catch (error) {
    logger.error('Reconnect error:', error);
    console.error('❌ Reconnect error:', error);
    res.status(500).json({ error: `Failed to reconnect: ${error.message}` });
  }
});

// Test endpoint to verify authentication URL generation
router.get('/test-auth-url/:connectionId', authenticateToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Test endpoints not available in production' });
    }

    const { connectionId } = req.params;
    
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const state = JSON.stringify({ 
      connection_id: connectionId,
      user_id: req.user.id,
      reconnect: false 
    });
    
    const apiKey = decryptData(connection.api_key);
    const redirectUrl = `${baseUrl}/api/broker/auth/zerodha/callback`;
    const authUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3&redirect_url=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;

    res.json({
      connectionId,
      brokerName: connection.broker_name,
      authUrl,
      redirectUrl,
      state: JSON.parse(state),
      stateEncoded: encodeURIComponent(state)
    });

  } catch (error) {
    logger.error('Test auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate test auth URL' });
  }
});

// Diagnostics endpoint for debugging authentication issues
router.get('/connections/:id/diagnostics', authenticateToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Diagnostics not available in production' });
    }

    const { id: connectionId } = req.params;
    const diagnostics = await BrokerAuthDiagnostics.diagnoseConnection(connectionId, req.user.id);
    
    res.json({
      connectionId,
      userId: req.user.id,
      timestamp: new Date().toISOString(),
      ...diagnostics
    });

  } catch (error) {
    logger.error('Diagnostics error:', error);
    res.status(500).json({ error: 'Failed to run diagnostics' });
  }
});

// Batch diagnostics for all user connections
router.get('/diagnostics', authenticateToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Diagnostics not available in production' });
    }

    const diagnostics = await BrokerAuthDiagnostics.diagnoseAllConnections(req.user.id);
    
    res.json({
      userId: req.user.id,
      timestamp: new Date().toISOString(),
      results: diagnostics
    });

  } catch (error) {
    logger.error('Batch diagnostics error:', error);
    res.status(500).json({ error: 'Failed to run batch diagnostics' });
  }
});

// Token refresh endpoint for brokers that support it
router.post('/refresh-token/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Check if broker supports token refresh
    if (!connection.refresh_token) {
      return res.status(400).json({ 
        error: 'Token refresh not supported or refresh token not available for this broker',
        requiresReconnect: true 
      });
    }

    try {
      let newTokens;
      
      if (connection.broker_name.toLowerCase() === 'upstox') {
        // Upstox supports token refresh
        newTokens = await upstoxService.refreshAccessToken(connectionId);
      } else {
        // Most other brokers don't support refresh, require full re-auth
        return res.status(400).json({
          error: `Token refresh not supported for ${connection.broker_name}. Please reconnect your account.`,
          requiresReconnect: true
        });
      }

      if (newTokens && newTokens.access_token) {
        // Update tokens in database
        const encryptedAccessToken = encryptData(newTokens.access_token);
        const expiresAt = Math.floor(Date.now() / 1000) + (newTokens.expires_in || 86400); // Default 24 hours

        await db.runAsync(`
          UPDATE broker_connections 
          SET access_token = ?, access_token_expires_at = ?, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [encryptedAccessToken, expiresAt, connectionId]);

        logger.info(`Token refreshed successfully for connection ${connectionId}`);
        
        res.json({
          success: true,
          message: 'Access token refreshed successfully',
          expiresAt: expiresAt,
          expiresIn: newTokens.expires_in || 86400
        });
      } else {
        throw new Error('Invalid refresh response from broker');
      }

    } catch (refreshError) {
      logger.error('Token refresh failed:', refreshError);
      
      // Mark as needing re-authentication
      await db.runAsync(
        'UPDATE broker_connections SET is_authenticated = 0 WHERE id = ?',
        [connectionId]
      );

      res.status(400).json({
        error: 'Token refresh failed. Please reconnect your account.',
        details: refreshError.message,
        requiresReconnect: true
      });
    }

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Upstox OAuth callback handler
router.get('/auth/upstox/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Enhanced logging for debugging
    logger.info('Upstox callback received', { 
      hasCode: !!code, 
      codeLength: code ? code.length : 0,
      state, 
      error,
      query: JSON.stringify(req.query),
      headers: JSON.stringify(req.headers),
      url: req.originalUrl,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
    });

    // Log the raw request for debugging
    console.log('📥 Upstox callback raw request:', {
      url: req.originalUrl,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      query: req.query,
      headers: {
        host: req.get('host'),
        referer: req.get('referer'),
        origin: req.get('origin'),
        'user-agent': req.get('user-agent')
      }
    });

    // Check if authentication was successful
    if (error || !code) {
      logger.error('Upstox authentication failed', { error, hasCode: !!code });
      
      return res.status(400).send(`
        <html>
          <head><title>Authentication Failed</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
            <p>Upstox authentication was not successful.</p>
            <p>Error: ${error || 'No authorization code received'}</p>
            <p>Debug Info: ${JSON.stringify({ 
              hasCode: !!code, 
              url: req.originalUrl,
              host: req.get('host')
            })}</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    // Parse the state parameter
    let connectionId, reconnect, userId;
    try {
      const stateObj = state ? JSON.parse(decodeURIComponent(state)) : {};
      connectionId = stateObj.connection_id;
      userId = stateObj.user_id;
      reconnect = stateObj.reconnect;
      
      logger.info('Parsed state parameter:', { connectionId, userId, reconnect });
    } catch (e) {
      logger.error('Failed to parse state parameter:', e);
      // State parsing failed, but we'll try to find the connection below
    }

    // If no connection ID from state, try to find the most recent Upstox connection that needs authentication
    if (!connectionId) {
      logger.warn('No connection ID in state, attempting to find recent Upstox connection');
      
      try {
        const recentConnection = await db.getAsync(`
          SELECT id, user_id, broker_name, connection_name, created_at
          FROM broker_connections 
          WHERE broker_name = 'upstox' 
            AND is_active = 1 
            AND (access_token IS NULL OR access_token = '')
          ORDER BY created_at DESC 
          LIMIT 1
        `);
        
        if (recentConnection) {
          connectionId = recentConnection.id;
          userId = recentConnection.user_id;
          logger.info('Found recent Upstox connection:', { 
            connectionId, 
            userId, 
            connectionName: recentConnection.connection_name 
          });
        }
      } catch (dbError) {
        logger.error('Failed to find recent connection:', dbError);
      }
    }

    if (!connectionId) {
      return res.status(400).send(`
        <html>
          <head><title>Missing Connection ID</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Missing Connection ID</h1>
            <p>Connection ID is required for authentication.</p>
            <p><strong>Debug Info:</strong> State parameter was missing or invalid.</p>
            <p>Please try the authentication process again from the beginning.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    // Get broker connection
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ?',
      [connectionId]
    );

    if (!connection) {
      return res.status(404).send(`
        <html>
          <head><title>Connection Not Found</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Connection Not Found</h1>
            <p>Broker connection not found.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    try {
      // Check if encrypted credentials exist
      if (!connection.api_key) {
        throw new Error('API key not found in connection');
      }
      if (!connection.encrypted_api_secret) {
        throw new Error('API secret not found in connection');
      }

      // Decrypt credentials
      logger.info('Decrypting credentials for connection:', connectionId);
      const apiKey = decryptData(connection.api_key);
      const apiSecret = decryptData(connection.encrypted_api_secret);
      
      // Get redirect URI from the connection or use the fixed HTTP version
      // Using the exact URI registered in Upstox Developer account
      const redirectUri = connection.redirect_uri || `${req.protocol}://${req.get('host')}/api/broker/auth/upstox/callback`;
      
      // Log detailed information about the redirect URI
      logger.info('Redirect URI details', {
        connectionId,
        storedRedirectUri: connection.redirect_uri,
        finalRedirectUri: redirectUri,
        protocol: req.protocol,
        host: req.get('host'),
        headers: {
          'x-forwarded-proto': req.get('x-forwarded-proto'),
          'x-forwarded-host': req.get('x-forwarded-host')
        }
      });
      
      console.log('🔄 Redirect URI details:', {
        storedInDB: connection.redirect_uri,
        hardcoded: `${req.protocol}://${req.get('host')}/api/broker/auth/upstox/callback`,
        final: redirectUri
      });
      
      logger.info('Generating access token for connection', {
        connectionId,
        redirectUri,
        codeLength: code ? code.length : 0
      });
      
      // Generate access token using Upstox API
      const tokenResponse = await upstoxService.generateAccessToken(apiKey, apiSecret, code, redirectUri);
      
      if (!tokenResponse || !tokenResponse.access_token) {
        throw new Error('Failed to generate access token');
      }

      const accessToken = tokenResponse.access_token;
      const refreshToken = tokenResponse.refresh_token;
      
      // Set token expiry
      const expiresIn = tokenResponse.expires_in || 86400; // Default 24 hours
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

      // Store access token and refresh token
      const encryptedAccessToken = encryptData(accessToken);
      const encryptedRefreshToken = refreshToken ? encryptData(refreshToken) : null;

      // Clear any cached instances for this connection
      if (upstoxService.clearCachedInstance) {
        upstoxService.clearCachedInstance(connectionId);
      }

      // Update the connection in the database
      await db.runAsync(`
        UPDATE broker_connections 
        SET access_token = ?, 
            refresh_token = ?, 
            access_token_expires_at = ?, 
            is_active = 1, 
            is_authenticated = 1, 
            last_sync = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [encryptedAccessToken, encryptedRefreshToken, expiresAt, connectionId]);

      logger.info('Upstox authentication completed for connection:', connectionId);
      
      // Log additional details for debugging
      console.log('✅ Upstox authentication successful:', {
        connectionId,
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        reconnect: reconnect ? 'yes' : 'no'
      });

      const actionText = reconnect ? 'Reconnection Successful' : 'Authentication Successful';

      // Return success page
      res.send(`
        <html>
          <head>
            <title>${actionText}</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f8f9fa; }
              .success-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
              .success-icon { font-size: 48px; margin-bottom: 20px; }
              .success-title { color: #28a745; margin-bottom: 15px; }
              .success-message { color: #6c757d; margin-bottom: 30px; line-height: 1.6; }
              .close-btn { padding: 12px 24px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
              .close-btn:hover { background: #218838; }
            </style>
          </head>
          <body>
            <div class="success-container">
              <div class="success-icon">✅</div>
              <h1 class="success-title">${actionText}!</h1>
              <p class="success-message">
                Your Upstox account has been successfully ${reconnect ? 'reconnected' : 'connected'} to AutoTraderHub.<br>
                Access token expires: ${new Date(expiresAt * 1000).toLocaleString()}<br>
                You can now close this window and return to the dashboard.
              </p>
              <button class="close-btn" onclick="window.close()">Close Window</button>
            </div>
            <script>
              // Auto-close after 5 seconds
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </body>
        </html>
      `);

    } catch (authError) {
      logger.error('Upstox authentication error:', authError);
      res.status(500).send(`
        <html>
          <head><title>Authentication Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Authentication Error</h1>
            <p>Failed to complete Upstox authentication.</p>
            <p><strong>Error:</strong> ${authError.message}</p>
            <p>Please check your credentials and try again.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

  } catch (error) {
    logger.error('Upstox callback error:', error);
    res.status(500).send(`
      <html>
        <head><title>Server Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #dc3545;">❌ Server Error</h1>
          <p>An unexpected error occurred during authentication.</p>
          <p>Please try again or contact support if the issue persists.</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
        </body>
      </html>
    `);
  }
});

// Zerodha OAuth callback handler
router.get('/auth/zerodha/callback', async (req, res) => {
  try {
    const { request_token, action, status, state } = req.query;

    logger.info('Zerodha callback received:', { request_token, action, status, state });

    // Check if authentication was successful
    if (action !== 'login' || status !== 'success' || !request_token) {
      return res.status(400).send(`
        <html>
          <head><title>Authentication Failed</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
            <p>Zerodha authentication was not successful.</p>
            <p>Error: ${status || 'Unknown error'}</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    // Parse the state parameter
    let connectionId, reconnect, userId;
    try {
      const stateObj = state ? JSON.parse(decodeURIComponent(state)) : {};
      connectionId = stateObj.connection_id;
      userId = stateObj.user_id;
      reconnect = stateObj.reconnect;
      
      logger.info('Parsed state parameter:', { connectionId, userId, reconnect });
    } catch (e) {
      logger.error('Failed to parse state parameter:', e);
      // State parsing failed, but we'll try to find the connection below
    }

    // If no connection ID from state, try to find the most recent Zerodha connection that needs authentication
    if (!connectionId) {
      logger.warn('No connection ID in state, attempting to find recent Zerodha connection');
      
      try {
        const recentConnection = await db.getAsync(`
          SELECT id, user_id, broker_name, connection_name, created_at
          FROM broker_connections 
          WHERE broker_name = 'zerodha' 
            AND is_active = 1 
            AND (access_token IS NULL OR access_token = '')
          ORDER BY created_at DESC 
          LIMIT 1
        `);
        
        if (recentConnection) {
          connectionId = recentConnection.id;
          userId = recentConnection.user_id;
          logger.info('Found recent Zerodha connection:', { 
            connectionId, 
            userId, 
            connectionName: recentConnection.connection_name 
          });
        }
      } catch (dbError) {
        logger.error('Failed to find recent connection:', dbError);
      }
    }

    if (!connectionId) {
      return res.status(400).send(`
        <html>
          <head><title>Missing Connection ID</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Missing Connection ID</h1>
            <p>Connection ID is required for authentication.</p>
            <p><strong>Debug Info:</strong> State parameter was missing or invalid.</p>
            <p>Please try the authentication process again from the beginning.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    // Get broker connection
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ?',
      [connectionId]
    );

    if (!connection) {
      return res.status(404).send(`
        <html>
          <head><title>Connection Not Found</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Connection Not Found</h1>
            <p>Broker connection not found.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

    try {
      // Check if encrypted credentials exist
      if (!connection.api_key) {
        throw new Error('API key not found in connection');
      }
      if (!connection.encrypted_api_secret) {
        throw new Error('API secret not found in connection');
      }

      // Decrypt credentials
      logger.info('Decrypting credentials for connection:', connectionId);
      const apiKey = decryptData(connection.api_key);
      const apiSecret = decryptData(connection.encrypted_api_secret);
      
      logger.info('Generating access token for connection:', connectionId);
      
      // Generate access token using KiteConnect
      const accessTokenResponse = await kiteService.generateAccessToken(apiKey, apiSecret, request_token);
      
      if (!accessTokenResponse || !accessTokenResponse.access_token) {
        throw new Error('Failed to generate access token');
      }

      const accessToken = accessTokenResponse.access_token;
      const publicToken = accessTokenResponse.public_token || '';
      
      // Set token expiry (Zerodha tokens expire at 6 AM IST next day)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(6, 0, 0, 0); // 6 AM IST
      const expiresAt = Math.floor(tomorrow.getTime() / 1000);

      // Store access token
      const encryptedAccessToken = encryptData(accessToken);
      
      // Update the connection in the database
      const updateResult = await db.runAsync(`
        UPDATE broker_connections 
        SET access_token = ?, 
            access_token_expires_at = ?, 
            is_active = 1, 
            is_authenticated = 1, 
            last_sync = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [encryptedAccessToken, expiresAt, connectionId]);
      
      logger.info('Updated Zerodha connection in database', {
        connectionId,
        changes: updateResult.changes,
        expiresAt: new Date(expiresAt * 1000).toISOString()
      });

      // Clear any cached KiteConnect instances to force refresh
      if (kiteService.clearCachedInstance) {
        kiteService.clearCachedInstance(connectionId);
      }
      
      // Log additional details for debugging
      console.log('✅ Zerodha authentication successful:', {
        connectionId,
        hasAccessToken: !!accessToken,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        reconnect: reconnect ? 'yes' : 'no'
      });

      logger.info('Zerodha authentication completed for connection:', connectionId);

      const actionText = reconnect ? 'Reconnection Successful' : 'Authentication Successful';

      // Return success page
      res.send(`
        <html>
          <head>
            <title>${actionText}</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f8f9fa; }
              .success-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
              .success-icon { font-size: 48px; margin-bottom: 20px; }
              .success-title { color: #28a745; margin-bottom: 15px; }
              .success-message { color: #6c757d; margin-bottom: 30px; line-height: 1.6; }
              .close-btn { padding: 12px 24px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
              .close-btn:hover { background: #218838; }
            </style>
          </head>
          <body>
            <div class="success-container">
              <div class="success-icon">✅</div>
              <h1 class="success-title">${actionText}!</h1>
              <p class="success-message">
                Your Zerodha account has been successfully ${reconnect ? 'reconnected' : 'connected'} to AutoTraderHub.<br>
                New access token expires: ${new Date(expiresAt * 1000).toLocaleString()}<br>
                You can now close this window and return to the dashboard.
              </p>
              <button class="close-btn" onclick="window.close()">Close Window</button>
            </div>
            <script>
              // Auto-close after 5 seconds
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </body>
        </html>
      `);

    } catch (authError) {
      logger.error('Authentication error:', authError);
      res.status(500).send(`
        <html>
          <head><title>Authentication Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Authentication Error</h1>
            <p>Failed to complete authentication: ${authError.message}</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
          </body>
        </html>
      `);
    }

  } catch (error) {
    logger.error('Callback handler error:', error);
    res.status(500).send(`
      <html>
        <head><title>Server Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #dc3545;">❌ Server Error</h1>
          <p>An unexpected error occurred: ${error.message}</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
        </body>
      </html>
    `);
  }
});

// Angel Broking manual authentication endpoint
router.post('/auth/angel/login', authenticateToken, async (req, res) => {
  try {
    const { connectionId, clientCode, password, totp } = req.body;

    logger.info('Angel Broking manual authentication:', { connectionId, clientCode });

    if (!connectionId || !clientCode || !password) {
      return res.status(400).json({ 
        error: 'Connection ID, client code, and password are required' 
      });
    }

    // Get broker connection
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    try {
      // Decrypt credentials
      const apiKey = decryptData(connection.api_key);
      
      logger.info('Generating access token for Angel connection:', connectionId);
      
      // Generate access token using Angel API
      const accessTokenResponse = await angelService.generateAccessToken(apiKey, clientCode, password, totp);
      
      if (!accessTokenResponse || !accessTokenResponse.access_token) {
        throw new Error('Failed to generate access token');
      }

      const accessToken = accessTokenResponse.access_token;
      
      // Set token expiry (Angel tokens typically expire in 24 hours)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expiresAt = Math.floor(tomorrow.getTime() / 1000);

      // Store access token
      await db.runAsync(`
        UPDATE broker_connections 
        SET access_token = ?, access_token_expires_at = ?, is_active = 1, is_authenticated = 1, last_sync = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [encryptData(accessToken), expiresAt, connectionId]);

      // Clear any cached Angel instances to force refresh
      angelService.clearCachedInstance(connectionId);

      logger.info('Angel authentication completed for connection:', connectionId);

      res.json({
        success: true,
        message: 'Angel Broking authentication successful',
        connectionId,
        expiresAt: new Date(expiresAt * 1000).toISOString()
      });

    } catch (authError) {
      logger.error('Angel authentication error:', authError);
      res.status(500).json({
        error: 'Authentication failed',
        message: authError.message
      });
    }

  } catch (error) {
    logger.error('Angel manual authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

// Test Shoonya API credentials
router.post('/auth/shoonya/test-credentials', authenticateToken, async (req, res) => {
  try {
    const { userId, apiSecret, vendorCode } = req.body;

    if (!userId || !apiSecret || !vendorCode) {
      return res.status(400).json({ 
        error: 'User ID, API secret, and vendor code are required' 
      });
    }

    logger.info('Testing Shoonya API credentials');
    
    const result = await shoonyaService.testApiCredentials(userId, apiSecret, vendorCode);
    
    return res.json({
      success: true,
      message: 'API credentials format is valid',
      data: result
    });
  } catch (error) {
    logger.error('Failed to test Shoonya API credentials:', error);
    return res.status(500).json({ 
      error: 'Failed to test API credentials', 
      message: error.message 
    });
  }
});

// Shoonya manual authentication endpoint
router.post('/auth/shoonya/login', authenticateToken, async (req, res) => {
  try {
    const { connectionId, password, twoFA } = req.body;

    logger.info('Shoonya manual authentication:', { 
      connectionId, 
      hasPassword: !!password,
      hasTwoFA: !!twoFA
    });

    if (!connectionId || !password) {
      return res.status(400).json({ 
        error: 'Connection ID and password are required' 
      });
    }

    // Get broker connection with all stored details
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    // Extract all required parameters from the connection
    const userId = connection.user_id_broker;
    const vendorCode = connection.vendor_code;
    const imei = connection.imei || '';
    
    // Validate required parameters
    if (!userId || !vendorCode) {
      return res.status(400).json({ 
        error: 'Missing required parameters in broker connection. Please update your connection details.' 
      });
    }
    
    // Validate vendor code format
    if (vendorCode.length < 2 || vendorCode.length > 10) {
      logger.warn('Vendor code may be invalid:', { vendorCode, length: vendorCode.length });
    }

    try {
      // Decrypt credentials if needed
      let apiSecret;
      
      // For Shoonya, use api_key as the API secret (Shoonya doesn't have separate API secret)
      if (connection.api_key) {
        apiSecret = decryptData(connection.api_key);
        logger.debug('Using api_key as API secret for Shoonya authentication');
      } else {
        return res.status(400).json({ 
          error: 'API key is missing from Shoonya broker connection. Please update your connection details.' 
        });
      }
      
      // Log connection details for debugging
      logger.info('Generating session token for Shoonya connection:', {
        connectionId,
        userId,
        vendorCode,
        hasApiSecret: !!apiSecret,
        apiSecretLength: apiSecret ? apiSecret.length : 0
      });
      
      // Generate session token using Shoonya API
      // Parameters: userId, password, twoFA, vendorCode, apiSecret, imei
      const sessionResponse = await shoonyaService.generateSessionToken(
        userId, password, twoFA, vendorCode, apiSecret, imei
      );
      
      if (!sessionResponse || !sessionResponse.session_token) {
        throw new Error('Failed to generate session token');
      }

      const sessionToken = sessionResponse.session_token;
      
      // Set token expiry (Shoonya tokens typically expire at end of trading day)
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999); // End of day
      const expiresAt = Math.floor(endOfDay.getTime() / 1000);

      // Store session token and user ID
      await db.runAsync(`
        UPDATE broker_connections 
        SET access_token = ?, user_id_broker = ?, access_token_expires_at = ?, is_active = 1, is_authenticated = 1
        WHERE id = ?
      `, [encryptData(sessionToken), userId, expiresAt, connectionId]);

      // Clear any cached Shoonya instances to force refresh
      shoonyaService.clearCachedInstance(connectionId);

      logger.info('Shoonya authentication completed for connection:', connectionId);

      res.json({
        success: true,
        message: 'Shoonya authentication successful',
        connectionId,
        expiresAt: new Date(expiresAt * 1000).toISOString()
      });

    } catch (authError) {
      logger.error('Shoonya authentication error:', authError);
      
      // Provide more specific error messages based on the error
      let statusCode = 500;
      let errorMessage = 'Authentication failed';
      
      if (authError.message.includes('Invalid Vendor code')) {
        statusCode = 400;
        errorMessage = 'Invalid vendor code. Please check your vendor code and try again.';
      } else if (authError.message.includes('Invalid App Key')) {
        statusCode = 400;
        errorMessage = 'Invalid API secret or user ID. Please check your credentials and try again.';
      } else if (authError.message.includes('Invalid Input')) {
        statusCode = 400;
        errorMessage = 'Invalid input parameters. Please check all your credentials and try again.';
      }
      
      res.status(statusCode).json({
        error: errorMessage,
        message: authError.message,
        details: 'Please use the test-credentials endpoint to validate your API credentials format.'
      });
    }

  } catch (error) {
    logger.error('Shoonya manual authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

// Disconnect broker
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    logger.info('Disconnecting broker connection', { connectionId, userId: req.user.id });
    console.log('🔌 Disconnecting broker connection:', connectionId);

    // Verify the connection exists and belongs to the user
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
      [connectionId, req.user.id]
    );

    if (!connection) {
      logger.warn('Broker connection not found', { connectionId, userId: req.user.id });
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    console.log('🔍 Found broker connection:', {
      id: connection.id,
      broker_name: connection.broker_name,
      is_active: connection.is_active,
      is_authenticated: connection.is_authenticated
    });

    // Clear any cached instances for this connection
    let cacheCleared = false;
    try {
      if (connection.broker_name.toLowerCase() === 'zerodha' && kiteService.clearCachedInstance) {
        cacheCleared = kiteService.clearCachedInstance(connectionId);
        console.log('🗑️ Zerodha cache cleared:', cacheCleared);
      } else if (connection.broker_name.toLowerCase() === 'upstox' && upstoxService.clearCachedInstance) {
        cacheCleared = upstoxService.clearCachedInstance(connectionId);
        console.log('🗑️ Upstox cache cleared:', cacheCleared);
      } else if (connection.broker_name.toLowerCase() === 'angel' && angelService.clearCachedInstance) {
        cacheCleared = angelService.clearCachedInstance(connectionId);
        console.log('🗑️ Angel cache cleared:', cacheCleared);
      } else if (connection.broker_name.toLowerCase() === 'shoonya' && shoonyaService.clearCachedInstance) {
        cacheCleared = shoonyaService.clearCachedInstance(connectionId);
        console.log('🗑️ Shoonya cache cleared:', cacheCleared);
      }
    } catch (clearError) {
      logger.warn(`Error clearing cached instance: ${clearError.message}`);
      console.error('❌ Error clearing cached instance:', clearError);
      // Continue with disconnection even if clearing cache fails
    }

    // Update the connection status in the database - use explicit NULL values
    console.log('🔄 Updating database to disconnect broker...');
    const result = await db.runAsync(
      `UPDATE broker_connections 
       SET is_active = 0, 
           is_authenticated = 0, 
           access_token = NULL, 
           refresh_token = NULL, 
           feed_token = NULL,
           session_token = NULL,
           last_sync = CURRENT_TIMESTAMP 
       WHERE id = ? AND user_id = ?`,
      [connectionId, req.user.id]
    );
    
    console.log('🔄 Database update result:', {
      changes: result.changes,
      lastID: result.lastID
    });
    
    if (result.changes === 0) {
      logger.warn(`No changes made when disconnecting broker ${connectionId}`);
      return res.status(400).json({ error: 'Failed to disconnect broker. No changes were made.' });
    }
    
    // Verify the connection was actually updated
    const verifyConnection = await db.getAsync(
      'SELECT is_active, is_authenticated, access_token, refresh_token FROM broker_connections WHERE id = ?',
      [connectionId]
    );
    
    console.log('✅ Verification after disconnect:', {
      is_active: verifyConnection.is_active,
      is_authenticated: verifyConnection.is_authenticated,
      has_access_token: !!verifyConnection.access_token,
      has_refresh_token: !!verifyConnection.refresh_token
    });
    
    logger.info('Broker disconnected successfully', { 
      connectionId, 
      userId: req.user.id,
      changes: result.changes,
      cacheCleared
    });

    res.json({ 
      message: 'Broker disconnected successfully',
      success: true,
      connectionId,
      cacheCleared
    });
  } catch (error) {
    logger.error('Disconnect broker error:', error);
    console.error('❌ Disconnect broker error:', error);
    res.status(500).json({ error: `Failed to disconnect broker: ${error.message}` });
  }
});

// Delete broker connection
router.delete('/connections/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.runAsync(
      'DELETE FROM broker_connections WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    res.json({ message: 'Broker connection deleted successfully' });
  } catch (error) {
    logger.error('Delete broker connection error:', error);
    res.status(500).json({ error: 'Failed to delete broker connection' });
  }
});

// Mock sync positions
router.post('/sync/positions/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Verify connection belongs to user
    const connection = await db.getAsync(
      'SELECT id FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    // Try to sync positions using KiteService
    try {
      const positions = await kiteService.getPositions(connectionId);
      res.json({ 
        message: 'Positions synced successfully',
        positions: positions || []
      });
    } catch (syncError) {
      logger.error('Failed to sync positions from broker:', syncError);
      // Return mock data if sync fails
      const mockPositions = [
        {
          symbol: 'RELIANCE',
          quantity: 50,
          averagePrice: 2450,
          currentPrice: 2475,
          pnl: 1250,
          pnlPercentage: 1.02
        },
        {
          symbol: 'TCS',
          quantity: -25,
          averagePrice: 3200,
          currentPrice: 3180,
          pnl: 500,
          pnlPercentage: 0.63
        }
      ];

      res.json({ 
        message: 'Positions synced successfully (mock data)',
        positions: mockPositions
      });
    }
  } catch (error) {
    logger.error('Sync positions error:', error);
    res.status(500).json({ error: 'Failed to sync positions' });
  }
});

// Enhanced test connection with proper error handling
router.post('/test/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;

    logger.info('Testing connection for ID:', connectionId);

    // Verify connection belongs to user
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found' });
    }

    // Check if access token exists and is not expired
    const now = Math.floor(Date.now() / 1000);
    if (!connection.access_token) {
      return res.status(400).json({ 
        error: 'No access token found. Please authenticate first.',
        needsAuth: true 
      });
    }

    if (connection.access_token_expires_at && connection.access_token_expires_at < now) {
      return res.status(400).json({ 
        error: 'Access token has expired. Please reconnect your account.',
        tokenExpired: true 
      });
    }

    try {
      let testResult;

      if (connection.broker_name.toLowerCase() === 'zerodha') {
        // Test connection using KiteService
        testResult = await kiteService.testConnection(connectionId);
      } else if (connection.broker_name.toLowerCase() === 'upstox') {
        // Test connection using UpstoxService
        testResult = await upstoxService.getProfile(connectionId);
      } else if (connection.broker_name.toLowerCase() === 'angel') {
        // Test connection using AngelService
        testResult = await angelService.getProfile(connectionId);
      } else if (connection.broker_name.toLowerCase() === 'shoonya') {
        // Test connection using ShoonyaService
        testResult = await shoonyaService.getProfile(connectionId);
      } else {
        return res.status(400).json({ error: 'Unsupported broker' });
      }

      res.json({ 
        message: `${connection.broker_name} connection is working`,
        profile: testResult,
        tokenExpiresAt: connection.access_token_expires_at,
        tokenExpiresIn: connection.access_token_expires_at - now
      });

    } catch (testError) {
      logger.error('Connection test failed:', testError);
      
      // Check if it's a token-related error
      if (testError.message && (testError.message.includes('api_key') || testError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: testError.message
        });
      }

      res.status(500).json({ 
        error: 'Connection test failed',
        details: testError.message
      });
    }

  } catch (error) {
    logger.error('Test connection error:', error);
    res.status(500).json({ error: 'Broker connection test failed' });
  }
});

// Check Upstox API status
router.get('/debug/upstox-api-status', async (req, res) => {
  try {
    const apiStatus = await checkUpstoxApiStatus();
    return res.json(apiStatus);
  } catch (error) {
    logger.error('Failed to check Upstox API status:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Failed to check Upstox API status',
      error: error.message
    });
  }
});

// Debug endpoint for Upstox authentication
router.get('/debug/upstox-auth', async (req, res) => {
  try {
    const { connection_id } = req.query;
    
    if (!connection_id) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    // Get broker connection
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ?',
      [connection_id]
    );
    
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    // Get redirect URI - using the exact URI registered in Upstox Developer account
    const redirectUri = connection.redirect_uri || `${req.protocol}://${req.get('host')}/api/broker/auth/upstox/callback`;
    
    // Decrypt API key (but don't expose the secret)
    const apiKey = connection.api_key ? decryptData(connection.api_key) : null;
    const maskedApiKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : null;
    
    // Generate auth URL
    const state = encodeURIComponent(JSON.stringify({
      connection_id: connection.id,
      user_id: connection.user_id,
      debug: true
    }));
    
    const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?client_id=${apiKey}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
    
    // Return debug info
    return res.json({
      connection_id: connection.id,
      broker_name: connection.broker_name,
      connection_name: connection.connection_name,
      is_authenticated: !!connection.access_token,
      redirect_uri: redirectUri,
      masked_api_key: maskedApiKey,
      has_api_secret: !!connection.encrypted_api_secret,
      auth_url: authUrl,
      request_info: {
        protocol: req.protocol,
        host: req.get('host'),
        original_url: req.originalUrl,
        headers: {
          'x-forwarded-proto': req.get('x-forwarded-proto'),
          'x-forwarded-host': req.get('x-forwarded-host'),
          'host': req.get('host'),
          'origin': req.get('origin'),
          'referer': req.get('referer')
        }
      }
    });
  } catch (error) {
    logger.error('Debug endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Get orders from broker
router.get('/orders/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info(`Fetching orders for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let orders = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'zerodha') {
        const ordersData = await kiteService.getOrders(connectionId);
        
        if (ordersData && Array.isArray(ordersData)) {
          orders = ordersData.map(order => ({
            order_id: order.order_id,
            exchange_order_id: order.exchange_order_id,
            parent_order_id: order.parent_order_id,
            status: order.status,
            status_message: order.status_message,
            order_timestamp: order.order_timestamp,
            exchange_timestamp: order.exchange_timestamp,
            variety: order.variety,
            exchange: order.exchange,
            tradingsymbol: order.tradingsymbol,
            instrument_token: order.instrument_token,
            order_type: order.order_type,
            transaction_type: order.transaction_type,
            validity: order.validity,
            product: order.product,
            quantity: order.quantity,
            disclosed_quantity: order.disclosed_quantity,
            price: order.price,
            trigger_price: order.trigger_price,
            average_price: order.average_price,
            filled_quantity: order.filled_quantity,
            pending_quantity: order.pending_quantity,
            cancelled_quantity: order.cancelled_quantity
          }));
        }
      } else if (connection.broker_name.toLowerCase() === 'upstox') {
        const ordersData = await upstoxService.getOrders(connectionId);
        
        if (ordersData && Array.isArray(ordersData)) {
          orders = ordersData.map(order => ({
            order_id: order.order_id,
            exchange_order_id: order.exchange_order_id,
            status: order.status,
            order_timestamp: order.order_timestamp,
            exchange: order.exchange,
            tradingsymbol: order.instrument_token,
            instrument_token: order.instrument_token,
            order_type: order.order_type,
            transaction_type: order.transaction_type,
            product: order.product,
            quantity: order.quantity,
            price: order.price,
            trigger_price: order.trigger_price,
            average_price: order.average_price,
            filled_quantity: order.filled_quantity,
            pending_quantity: order.pending_quantity
          }));
        }
      } else if (connection.broker_name.toLowerCase() === 'shoonya') {
        const ordersData = await shoonyaService.getOrders(connectionId);
        
        if (ordersData && ordersData.orders && Array.isArray(ordersData.orders)) {
          orders = ordersData.orders.map(order => ({
            order_id: order.norenordno,
            exchange_order_id: order.exordno,
            status: order.status,
            status_message: order.rejreason || '',
            order_timestamp: order.norentm,
            exchange_timestamp: order.exch_tm,
            exchange: order.exch,
            tradingsymbol: order.tsym,
            instrument_token: order.token,
            order_type: order.prctyp,
            transaction_type: order.trantype,
            validity: order.ret,
            product: order.prd,
            quantity: parseInt(order.qty || 0),
            disclosed_quantity: parseInt(order.dscqty || 0),
            price: parseFloat(order.prc || 0),
            trigger_price: parseFloat(order.trgprc || 0),
            average_price: parseFloat(order.avgprc || 0),
            filled_quantity: parseInt(order.fillshares || 0),
            pending_quantity: parseInt(order.qty || 0) - parseInt(order.fillshares || 0),
            cancelled_quantity: 0
          }));
        }
      } else if (connection.broker_name.toLowerCase() === 'angel') {
        const ordersData = await angelService.getOrders(connectionId);
        
        if (ordersData && ordersData.data && Array.isArray(ordersData.data)) {
          orders = ordersData.data.map(order => ({
            order_id: order.orderid,
            exchange_order_id: order.exchangeorderid,
            status: order.status,
            order_timestamp: order.ordertime,
            exchange: order.exchange,
            tradingsymbol: order.tradingsymbol,
            instrument_token: order.symboltoken,
            order_type: order.ordertype,
            transaction_type: order.transactiontype,
            product: order.producttype,
            quantity: parseInt(order.quantity || 0),
            price: parseFloat(order.price || 0),
            trigger_price: parseFloat(order.triggerprice || 0),
            average_price: parseFloat(order.averageprice || 0),
            filled_quantity: parseInt(order.filledshares || 0),
            pending_quantity: parseInt(order.unfilledshares || 0)
          }));
        }
      } else {
        logger.warn(`Orders not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Orders not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved ${orders.length} orders for connection ${connectionId}`);
      
      res.json({
        orders,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch orders from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch orders from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get trade book from broker (Shoonya specific)
router.get('/tradebook/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info(`Fetching trade book for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let trades = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const tradesData = await shoonyaService.getTradeBook(connectionId);
        
        if (tradesData && tradesData.trades && Array.isArray(tradesData.trades)) {
          trades = tradesData.trades.map(trade => ({
            trade_id: trade.norenordno,
            order_id: trade.norenordno,
            exchange_order_id: trade.exordno,
            exchange: trade.exch,
            tradingsymbol: trade.tsym,
            instrument_token: trade.token,
            product: trade.prd,
            quantity: parseInt(trade.qty || 0),
            price: parseFloat(trade.prc || 0),
            transaction_type: trade.trantype,
            trade_timestamp: trade.norentm,
            exchange_timestamp: trade.exch_tm
          }));
        }
      } else {
        logger.warn(`Trade book not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Trade book not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved ${trades.length} trades for connection ${connectionId}`);
      
      res.json({
        trades,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch trade book from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch trade book from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get trade book error:', error);
    res.status(500).json({ error: 'Failed to fetch trade book' });
  }
});

// Get limits/margins from broker
router.get('/limits/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { product_type, segment, exchange } = req.query;
    
    logger.info(`Fetching limits for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let limits = {};
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const limitsData = await shoonyaService.getLimits(connectionId, product_type, segment, exchange);
        
        if (limitsData && limitsData.limits) {
          limits = {
            cash: parseFloat(limitsData.limits.cash || 0),
            payin: parseFloat(limitsData.limits.payin || 0),
            payout: parseFloat(limitsData.limits.payout || 0),
            brkcollamt: parseFloat(limitsData.limits.brkcollamt || 0),
            unclearedcash: parseFloat(limitsData.limits.unclearedcash || 0),
            daycash: parseFloat(limitsData.limits.daycash || 0),
            marginused: parseFloat(limitsData.limits.marginused || 0),
            mtomcurper: parseFloat(limitsData.limits.mtomcurper || 0)
          };
        }
      } else {
        logger.warn(`Limits not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Limits not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved limits for connection ${connectionId}`);
      
      res.json({
        limits,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch limits from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch limits from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get limits error:', error);
    res.status(500).json({ error: 'Failed to fetch limits' });
  }
});

// Get watchlist names (Shoonya specific)
router.get('/watchlists/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    logger.info(`Fetching watchlist names for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let watchlists = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const watchlistsData = await shoonyaService.getWatchlistNames(connectionId);
        
        if (watchlistsData && watchlistsData.watchlists) {
          watchlists = watchlistsData.watchlists;
        }
      } else {
        logger.warn(`Watchlists not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Watchlists not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved ${watchlists.length} watchlists for connection ${connectionId}`);
      
      res.json({
        watchlists,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch watchlists from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch watchlists from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get watchlists error:', error);
    res.status(500).json({ error: 'Failed to fetch watchlists' });
  }
});

// Get specific watchlist (Shoonya specific)
router.get('/watchlist/:connectionId/:watchlistName', authenticateToken, async (req, res) => {
  try {
    const { connectionId, watchlistName } = req.params;
    
    logger.info(`Fetching watchlist ${watchlistName} for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let watchlist = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const watchlistData = await shoonyaService.getWatchlist(connectionId, watchlistName);
        
        if (watchlistData && watchlistData.watchlist) {
          watchlist = watchlistData.watchlist;
        }
      } else {
        logger.warn(`Watchlist not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Watchlist not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved watchlist ${watchlistName} with ${watchlist.length} items for connection ${connectionId}`);
      
      res.json({
        watchlist_name: watchlistName,
        watchlist,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch watchlist from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch watchlist from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get watchlist error:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

// Search symbols (Shoonya specific)
router.get('/search/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { symbol, exchange = 'NSE' } = req.query;
    
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol parameter is required' });
    }
    
    logger.info(`Searching symbol ${symbol} on ${exchange} for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let searchResults = [];
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const searchData = await shoonyaService.searchSymbol(connectionId, symbol, exchange);
        
        if (searchData && Array.isArray(searchData)) {
          searchResults = searchData.map(result => ({
            exchange: result.exch,
            token: result.token,
            trading_symbol: result.tsym,
            symbol: result.tsym,
            company_name: result.cname,
            instrument_type: result.instname,
            lot_size: parseInt(result.ls || 1),
            tick_size: parseFloat(result.ti || 0.05)
          }));
        }
      } else {
        logger.warn(`Symbol search not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Symbol search not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Found ${searchResults.length} results for symbol ${symbol} on ${exchange}`);
      
      res.json({
        search_query: symbol,
        exchange,
        results: searchResults,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to search symbols from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to search symbols from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Search symbols error:', error);
    res.status(500).json({ error: 'Failed to search symbols' });
  }
});

// Get market data/quotes (Shoonya specific)
router.get('/quotes/:connectionId', authenticateToken, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { exchange, token } = req.query;
    
    if (!exchange || !token) {
      return res.status(400).json({ error: 'Exchange and token parameters are required' });
    }
    
    logger.info(`Fetching quotes for ${exchange}:${token} for connection ${connectionId}`);

    // Verify connection belongs to user and is active
    const connection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND user_id = ? AND is_active = 1',
      [connectionId, req.user.id]
    );

    if (!connection) {
      return res.status(404).json({ error: 'Broker connection not found or inactive' });
    }

    // Validate token and handle expiration
    const tokenValidation = await validateTokenAndHandleExpiration(connection, res, logger);
    if (!tokenValidation.valid) {
      return tokenValidation.response;
    }

    let quotes = {};
    
    try {
      if (connection.broker_name.toLowerCase() === 'shoonya') {
        const quotesData = await shoonyaService.getMarketData(connectionId, exchange, token);
        
        if (quotesData && quotesData.stat === 'Ok') {
          quotes = {
            exchange: quotesData.exch,
            token: quotesData.token,
            trading_symbol: quotesData.tsym,
            last_price: parseFloat(quotesData.lp || 0),
            change: parseFloat(quotesData.c || 0),
            change_percentage: parseFloat(quotesData.prcftr_d || 0),
            volume: parseInt(quotesData.v || 0),
            average_price: parseFloat(quotesData.ap || 0),
            lower_circuit: parseFloat(quotesData.lc || 0),
            upper_circuit: parseFloat(quotesData.uc || 0),
            open: parseFloat(quotesData.o || 0),
            high: parseFloat(quotesData.h || 0),
            low: parseFloat(quotesData.l || 0),
            close: parseFloat(quotesData.c || 0),
            bid_price: parseFloat(quotesData.bp1 || 0),
            bid_quantity: parseInt(quotesData.bq1 || 0),
            ask_price: parseFloat(quotesData.sp1 || 0),
            ask_quantity: parseInt(quotesData.sq1 || 0)
          };
        }
      } else {
        logger.warn(`Market data not implemented for ${connection.broker_name}`);
        return res.status(400).json({ 
          error: `Market data not supported for ${connection.broker_name}` 
        });
      }

      logger.info(`Retrieved market data for ${exchange}:${token}`);
      
      res.json({
        quotes,
        broker_name: connection.broker_name,
        last_updated: new Date().toISOString(),
        connection_id: connectionId
      });

    } catch (brokerError) {
      logger.error('Failed to fetch market data from broker:', brokerError);
      
      if (brokerError.message && (brokerError.message.includes('api_key') || brokerError.message.includes('access_token'))) {
        return res.status(401).json({ 
          error: 'Invalid or expired credentials. Please reconnect your account.',
          tokenExpired: true,
          details: brokerError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch market data from broker',
        details: brokerError.message
      });
    }

  } catch (error) {
    logger.error('Get market data error:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

export default router;
