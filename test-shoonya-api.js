#!/usr/bin/env node

/**
 * Shoonya API Test Script
 * 
 * This script tests all the Shoonya API endpoints to ensure they are working correctly
 * and match the GitHub API implementation.
 */

import shoonyaService from './server/services/shoonyaService.js';
import { createLogger } from './server/utils/logger.js';

const logger = createLogger('ShoonyaAPITest');

// Test configuration - Replace with your actual test credentials
const TEST_CONFIG = {
  userId: 'YOUR_USER_ID',
  password: 'YOUR_PASSWORD',
  twoFA: 'YOUR_2FA_CODE', // Optional
  vendorCode: 'YOUR_VENDOR_CODE',
  apiSecret: 'YOUR_API_SECRET',
  imei: 'YOUR_IMEI' // Optional
};

// Mock connection ID for testing
const TEST_CONNECTION_ID = 'test-connection-123';

async function testShoonyaAPI() {
  try {
    logger.info('🚀 Starting Shoonya API Tests');
    logger.info('=' .repeat(50));

    // Test 1: Generate Session Token
    logger.info('📝 Test 1: Generate Session Token');
    try {
      const sessionResponse = await shoonyaService.generateSessionToken(
        TEST_CONFIG.userId,
        TEST_CONFIG.password,
        TEST_CONFIG.twoFA,
        TEST_CONFIG.vendorCode,
        TEST_CONFIG.apiSecret,
        TEST_CONFIG.imei
      );
      
      logger.info('✅ Session token generated successfully');
      logger.info('Session Token:', sessionResponse.session_token?.substring(0, 10) + '...');
      logger.info('User ID:', sessionResponse.user_id);
      logger.info('Account ID:', sessionResponse.account_id);
    } catch (error) {
      logger.error('❌ Session token generation failed:', error.message);
      return; // Exit if login fails
    }

    // Test 2: Test API Credentials
    logger.info('\n📝 Test 2: Test API Credentials');
    try {
      const credentialsTest = await shoonyaService.testApiCredentials(
        TEST_CONFIG.userId,
        TEST_CONFIG.apiSecret,
        TEST_CONFIG.vendorCode
      );
      
      logger.info('✅ API credentials test passed');
      logger.info('Credentials Valid:', credentialsTest.valid);
      logger.info('App Key Hash:', credentialsTest.appKeyHash);
    } catch (error) {
      logger.error('❌ API credentials test failed:', error.message);
    }

    // Test 3: Get User Profile
    logger.info('\n📝 Test 3: Get User Profile');
    try {
      const profile = await shoonyaService.getProfile(TEST_CONNECTION_ID);
      logger.info('✅ User profile retrieved successfully');
      logger.info('Profile data available:', !!profile);
    } catch (error) {
      logger.error('❌ Get user profile failed:', error.message);
    }

    // Test 4: Get Positions
    logger.info('\n📝 Test 4: Get Positions');
    try {
      const positions = await shoonyaService.getPositions(TEST_CONNECTION_ID);
      logger.info('✅ Positions retrieved successfully');
      logger.info('Positions count:', positions.positions?.length || 0);
    } catch (error) {
      logger.error('❌ Get positions failed:', error.message);
    }

    // Test 5: Get Holdings
    logger.info('\n📝 Test 5: Get Holdings');
    try {
      const holdings = await shoonyaService.getHoldings(TEST_CONNECTION_ID);
      logger.info('✅ Holdings retrieved successfully');
      logger.info('Holdings count:', holdings.holdings?.length || 0);
    } catch (error) {
      logger.error('❌ Get holdings failed:', error.message);
    }

    // Test 6: Get Orders
    logger.info('\n📝 Test 6: Get Orders');
    try {
      const orders = await shoonyaService.getOrders(TEST_CONNECTION_ID);
      logger.info('✅ Orders retrieved successfully');
      logger.info('Orders count:', orders.orders?.length || 0);
    } catch (error) {
      logger.error('❌ Get orders failed:', error.message);
    }

    // Test 7: Get Trade Book
    logger.info('\n📝 Test 7: Get Trade Book');
    try {
      const trades = await shoonyaService.getTradeBook(TEST_CONNECTION_ID);
      logger.info('✅ Trade book retrieved successfully');
      logger.info('Trades count:', trades.trades?.length || 0);
    } catch (error) {
      logger.error('❌ Get trade book failed:', error.message);
    }

    // Test 8: Get Limits
    logger.info('\n📝 Test 8: Get Limits');
    try {
      const limits = await shoonyaService.getLimits(TEST_CONNECTION_ID);
      logger.info('✅ Limits retrieved successfully');
      logger.info('Limits data available:', !!limits.limits);
    } catch (error) {
      logger.error('❌ Get limits failed:', error.message);
    }

    // Test 9: Get Watchlist Names
    logger.info('\n📝 Test 9: Get Watchlist Names');
    try {
      const watchlists = await shoonyaService.getWatchlistNames(TEST_CONNECTION_ID);
      logger.info('✅ Watchlist names retrieved successfully');
      logger.info('Watchlists count:', watchlists.watchlists?.length || 0);
    } catch (error) {
      logger.error('❌ Get watchlist names failed:', error.message);
    }

    // Test 10: Search Symbol
    logger.info('\n📝 Test 10: Search Symbol');
    try {
      const searchResults = await shoonyaService.searchSymbol(TEST_CONNECTION_ID, 'RELIANCE', 'NSE');
      logger.info('✅ Symbol search completed successfully');
      logger.info('Search results count:', Array.isArray(searchResults) ? searchResults.length : 0);
    } catch (error) {
      logger.error('❌ Symbol search failed:', error.message);
    }

    // Test 11: Get Market Data
    logger.info('\n📝 Test 11: Get Market Data');
    try {
      // Using RELIANCE token as example (replace with actual token)
      const marketData = await shoonyaService.getMarketData(TEST_CONNECTION_ID, 'NSE', '2885');
      logger.info('✅ Market data retrieved successfully');
      logger.info('Market data available:', !!marketData);
    } catch (error) {
      logger.error('❌ Get market data failed:', error.message);
    }

    // Test 12: Get Option Chain
    logger.info('\n📝 Test 12: Get Option Chain');
    try {
      const optionChain = await shoonyaService.getOptionChain(TEST_CONNECTION_ID, 'NSE', 'NIFTY', '18000', 5);
      logger.info('✅ Option chain retrieved successfully');
      logger.info('Option chain data available:', !!optionChain);
    } catch (error) {
      logger.error('❌ Get option chain failed:', error.message);
    }

    // Test 13: Logout
    logger.info('\n📝 Test 13: Logout');
    try {
      const logoutResult = await shoonyaService.logout(TEST_CONNECTION_ID);
      logger.info('✅ Logout completed successfully');
      logger.info('Logout status:', logoutResult.stat);
    } catch (error) {
      logger.error('❌ Logout failed:', error.message);
    }

    logger.info('\n' + '=' .repeat(50));
    logger.info('🎉 Shoonya API Tests Completed');
    logger.info('=' .repeat(50));

  } catch (error) {
    logger.error('💥 Test suite failed:', error);
  }
}

// Test order placement (commented out for safety)
async function testOrderPlacement() {
  logger.info('\n📝 Test: Place Order (DEMO - NOT EXECUTED)');
  
  const orderParams = {
    exch: 'NSE',
    tsym: 'RELIANCE-EQ',
    qty: '1',
    prc: '2500',
    prd: 'I', // Intraday
    trantype: 'B', // Buy
    prctyp: 'LMT', // Limit
    ret: 'DAY', // Day order
    remarks: 'Test order from API'
  };
  
  logger.info('Order parameters:', orderParams);
  logger.info('⚠️  Order placement test is commented out for safety');
  logger.info('⚠️  Uncomment and modify the test script to test order placement');
  
  // Uncomment below to test order placement (BE CAREFUL!)
  /*
  try {
    const orderResult = await shoonyaService.placeOrder(TEST_CONNECTION_ID, orderParams);
    logger.info('✅ Order placed successfully');
    logger.info('Order ID:', orderResult.order_id);
  } catch (error) {
    logger.error('❌ Order placement failed:', error.message);
  }
  */
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if test configuration is provided
  if (TEST_CONFIG.userId === 'YOUR_USER_ID') {
    logger.error('❌ Please update TEST_CONFIG with your actual Shoonya credentials');
    logger.info('📝 Edit the TEST_CONFIG object in this file with your credentials');
    process.exit(1);
  }
  
  testShoonyaAPI()
    .then(() => {
      logger.info('✅ All tests completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Test suite failed:', error);
      process.exit(1);
    });
}

export { testShoonyaAPI, testOrderPlacement };
