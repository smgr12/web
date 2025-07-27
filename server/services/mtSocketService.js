import axios from 'axios';
import { db } from '../database/init.js';
import { encryptData, decryptData } from '../utils/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MTSocketService');

class MTSocketService {
  constructor() {
    this.mtInstances = new Map(); // Store MT instances per connection
    this.baseURL = 'https://www.mtsocketapi.com'; // Base URL for MT Socket API
  }

  // Initialize MT instance for a connection
  async initializeMT(brokerConnection) {
    try {
      logger.info(`Initializing MT instance for connection ${brokerConnection.id}`);

      if (!brokerConnection.api_key) {
        throw new Error('API key is missing from broker connection');
      }

      if (!brokerConnection.encrypted_api_secret) {
        throw new Error('API secret is missing from broker connection');
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (brokerConnection.access_token_expires_at && brokerConnection.access_token_expires_at < now) {
        throw new Error('Access token has expired. Please refresh your token.');
      }

      const apiKey = decryptData(brokerConnection.api_key);
      const apiSecret = decryptData(brokerConnection.encrypted_api_secret);
      const accessToken = brokerConnection.access_token ? decryptData(brokerConnection.access_token) : null;

      const mtInstance = {
        apiKey,
        apiSecret,
        accessToken,
        baseURL: this.baseURL,
        platform: brokerConnection.broker_name, // 'mt4' or 'mt5'
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': accessToken ? `Bearer ${accessToken}` : undefined
        }
      };

      // Test the connection
      await this.testConnection(mtInstance);

      this.mtInstances.set(brokerConnection.id, mtInstance);
      logger.info(`MT instance initialized for connection ${brokerConnection.id}`);
      
      return mtInstance;
    } catch (error) {
      logger.error('Failed to initialize MT instance:', error);
      throw new Error(`Failed to initialize MT connection: ${error.message}`);
    }
  }

  // Get or create MT instance
  async getMTInstance(brokerConnectionId) {
    logger.info(`Getting MT instance for connection ${brokerConnectionId}`);
    
    if (this.mtInstances.has(brokerConnectionId)) {
      logger.info('Using cached MT instance');
      return this.mtInstances.get(brokerConnectionId);
    }

    logger.info('Fetching broker connection from database');
    const brokerConnection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND is_active = 1',
      [brokerConnectionId]
    );

    if (!brokerConnection) {
      logger.error('Broker connection not found or inactive');
      throw new Error('Broker connection not found or inactive');
    }

    logger.info('Broker connection found, initializing MT');
    return await this.initializeMT(brokerConnection);
  }

  // Generate access token
  async generateAccessToken(apiKey, apiSecret, serverUrl, login, password) {
    try {
      logger.info('Generating MT access token');
      
      const authUrl = `${this.baseURL}/api/auth/login`;
      const data = {
        api_key: apiKey,
        api_secret: apiSecret,
        server_url: serverUrl,
        login: login,
        password: password
      };

      const response = await axios.post(authUrl, data, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      if (response.data.success) {
        logger.info('MT access token generated successfully');
        return {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_in: response.data.expires_in
        };
      } else {
        throw new Error(response.data.message || 'Failed to generate access token');
      }
    } catch (error) {
      logger.error('Failed to generate MT access token:', error);
      throw new Error(`Failed to generate access token: ${error.response?.data?.message || error.message}`);
    }
  }

  // Test connection
  async testConnection(mtInstance) {
    try {
      const response = await axios.get(`${mtInstance.baseURL}/api/account/info`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT connection test successful');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Connection test failed');
      }
    } catch (error) {
      logger.error('MT connection test failed:', error);
      throw new Error(`Connection test failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Place order
  async placeOrder(brokerConnectionId, orderParams) {
    try {
      logger.info(`Placing MT order for connection ${brokerConnectionId}`);
      
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      // Validate required parameters
      if (!orderParams.symbol) {
        throw new Error('symbol is required for MT orders');
      }
      if (!orderParams.action) {
        throw new Error('action is required');
      }
      if (!orderParams.volume) {
        throw new Error('volume is required');
      }

      // Map order parameters to MT format
      const mtOrderData = {
        symbol: orderParams.symbol,
        action: orderParams.action.toUpperCase(), // BUY or SELL
        volume: parseFloat(orderParams.volume),
        order_type: orderParams.order_type || 'MARKET',
        price: orderParams.order_type === 'LIMIT' ? parseFloat(orderParams.price || 0) : 0,
        stoploss: parseFloat(orderParams.stoploss || 0),
        takeprofit: parseFloat(orderParams.takeprofit || 0),
        comment: orderParams.comment || 'AutoTraderHub',
        magic: parseInt(orderParams.magic || 12345),
        deviation: parseInt(orderParams.deviation || 10) // MT5 only
      };

      logger.info('Placing order with MT API:', mtOrderData);
      
      const endpoint = mtInstance.platform === 'mt5' ? '/api/trade/order' : '/api/trade/order';
      const response = await axios.post(
        `${mtInstance.baseURL}${endpoint}`,
        mtOrderData,
        { headers: mtInstance.headers }
      );

      if (response.data.success) {
        logger.info('MT order placed successfully:', response.data);
        
        return {
          success: true,
          order_id: response.data.data.order_id || response.data.data.ticket,
          data: response.data.data
        };
      } else {
        throw new Error(response.data.message || 'Order placement failed');
      }
    } catch (error) {
      logger.error('Failed to place MT order:', error);
      throw new Error(`Order placement failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get account information
  async getAccountInfo(brokerConnectionId) {
    try {
      logger.info(`Getting MT account info for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/account/info`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT account info retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get account info');
      }
    } catch (error) {
      logger.error('Failed to get MT account info:', error);
      throw new Error(`Failed to get account info: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get positions
  async getPositions(brokerConnectionId) {
    try {
      logger.info(`Getting MT positions for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/positions`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT positions retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get positions');
      }
    } catch (error) {
      logger.error('Failed to get MT positions:', error);
      throw new Error(`Failed to get positions: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get orders
  async getOrders(brokerConnectionId) {
    try {
      logger.info(`Getting MT orders for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/orders`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT orders retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get orders');
      }
    } catch (error) {
      logger.error('Failed to get MT orders:', error);
      throw new Error(`Failed to get orders: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get order history
  async getOrderHistory(brokerConnectionId, fromDate = null, toDate = null) {
    try {
      logger.info(`Getting MT order history for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      
      const response = await axios.get(`${mtInstance.baseURL}/api/history/orders`, {
        headers: mtInstance.headers,
        params
      });
      
      if (response.data.success) {
        logger.info('MT order history retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get order history');
      }
    } catch (error) {
      logger.error('Failed to get MT order history:', error);
      throw new Error(`Failed to get order history: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get trade history
  async getTradeHistory(brokerConnectionId, fromDate = null, toDate = null) {
    try {
      logger.info(`Getting MT trade history for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      
      const response = await axios.get(`${mtInstance.baseURL}/api/history/trades`, {
        headers: mtInstance.headers,
        params
      });
      
      if (response.data.success) {
        logger.info('MT trade history retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get trade history');
      }
    } catch (error) {
      logger.error('Failed to get MT trade history:', error);
      throw new Error(`Failed to get trade history: ${error.response?.data?.message || error.message}`);
    }
  }

  // Modify order
  async modifyOrder(brokerConnectionId, orderParams) {
    try {
      logger.info(`Modifying MT order for connection ${brokerConnectionId}`);
      
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      // Validate required parameters
      if (!orderParams.order_id && !orderParams.ticket) {
        throw new Error('order_id or ticket is required for modifying MT orders');
      }

      const mtOrderData = {
        order_id: orderParams.order_id || orderParams.ticket,
        price: parseFloat(orderParams.price || 0),
        stoploss: parseFloat(orderParams.stoploss || 0),
        takeprofit: parseFloat(orderParams.takeprofit || 0),
        volume: parseFloat(orderParams.volume || 0)
      };

      logger.info('Modifying order with MT API:', mtOrderData);
      
      const response = await axios.put(
        `${mtInstance.baseURL}/api/trade/modify`,
        mtOrderData,
        { headers: mtInstance.headers }
      );
      
      if (response.data.success) {
        logger.info('MT order modified successfully:', response.data);
        return {
          success: true,
          order_id: response.data.data.order_id,
          data: response.data.data
        };
      } else {
        throw new Error(response.data.message || 'Order modification failed');
      }
    } catch (error) {
      logger.error('Failed to modify MT order:', error);
      throw new Error(`Order modification failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Cancel order
  async cancelOrder(brokerConnectionId, orderId) {
    try {
      logger.info(`Cancelling MT order ${orderId} for connection ${brokerConnectionId}`);
      
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.delete(`${mtInstance.baseURL}/api/trade/order/${orderId}`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT order cancelled successfully:', response.data);
        return {
          success: true,
          order_id: orderId,
          data: response.data.data
        };
      } else {
        throw new Error(response.data.message || 'Order cancellation failed');
      }
    } catch (error) {
      logger.error('Failed to cancel MT order:', error);
      throw new Error(`Order cancellation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Close position
  async closePosition(brokerConnectionId, positionParams) {
    try {
      logger.info(`Closing MT position for connection ${brokerConnectionId}`);
      
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const mtPositionData = {
        symbol: positionParams.symbol,
        volume: parseFloat(positionParams.volume || 0),
        ticket: positionParams.ticket || positionParams.position_id
      };

      logger.info('Closing position with MT API:', mtPositionData);
      
      const response = await axios.post(
        `${mtInstance.baseURL}/api/trade/close`,
        mtPositionData,
        { headers: mtInstance.headers }
      );
      
      if (response.data.success) {
        logger.info('MT position closed successfully:', response.data);
        return {
          success: true,
          order_id: response.data.data.order_id,
          data: response.data.data
        };
      } else {
        throw new Error(response.data.message || 'Position close failed');
      }
    } catch (error) {
      logger.error('Failed to close MT position:', error);
      throw new Error(`Position close failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get symbols
  async getSymbols(brokerConnectionId) {
    try {
      logger.info(`Getting MT symbols for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/symbols`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT symbols retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get symbols');
      }
    } catch (error) {
      logger.error('Failed to get MT symbols:', error);
      throw new Error(`Failed to get symbols: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get symbol info
  async getSymbolInfo(brokerConnectionId, symbol) {
    try {
      logger.info(`Getting MT symbol info for ${symbol}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/symbols/${symbol}`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT symbol info retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get symbol info');
      }
    } catch (error) {
      logger.error('Failed to get MT symbol info:', error);
      throw new Error(`Failed to get symbol info: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get market data
  async getMarketData(brokerConnectionId, symbols) {
    try {
      logger.info(`Getting MT market data for connection ${brokerConnectionId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.post(`${mtInstance.baseURL}/api/market/quotes`, {
        symbols: Array.isArray(symbols) ? symbols : [symbols]
      }, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT market data retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get market data');
      }
    } catch (error) {
      logger.error('Failed to get MT market data:', error);
      throw new Error(`Failed to get market data: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get order status
  async getOrderStatus(brokerConnectionId, orderId) {
    try {
      logger.info(`Getting MT order status for order ${orderId}`);
      const mtInstance = await this.getMTInstance(brokerConnectionId);
      
      const response = await axios.get(`${mtInstance.baseURL}/api/orders/${orderId}`, {
        headers: mtInstance.headers
      });
      
      if (response.data.success) {
        logger.info('MT order status retrieved successfully');
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to get order status');
      }
    } catch (error) {
      logger.error('Failed to get MT order status:', error);
      throw new Error(`Failed to get order status: ${error.response?.data?.message || error.message}`);
    }
  }

  // Clear cached instance
  clearCachedInstance(brokerConnectionId) {
    if (this.mtInstances.has(brokerConnectionId)) {
      this.mtInstances.delete(brokerConnectionId);
      logger.info(`Cleared cached MT instance for connection ${brokerConnectionId}`);
    }
  }
}

export default new MTSocketService();