import { db } from '../database/init.js';
import { decryptData, testEncryption } from './encryption.js';
import createLogger from './logger.js';
import kiteService from '../services/kiteService.js';
import upstoxService from '../services/upstoxService.js';

const logger = createLogger('BrokerAuthDiagnostics');

/**
 * Comprehensive broker authentication diagnostics
 * Use this to debug authentication issues
 */
export class BrokerAuthDiagnostics {
  
  /**
   * Run full diagnostics for a specific connection
   */
  static async diagnoseConnection(connectionId, userId) {
    console.log('🔍 ===== BROKER AUTHENTICATION DIAGNOSTICS =====');
    console.log(`🔍 Connection ID: ${connectionId}`);
    console.log(`🔍 User ID: ${userId}`);
    
    const issues = [];
    const warnings = [];
    let connection;

    try {
      // Test 1: Check encryption system
      console.log('\n📋 TEST 1: Encryption System');
      const encryptionWorking = testEncryption();
      if (!encryptionWorking) {
        issues.push('Encryption system is not working properly');
      } else {
        console.log('✅ Encryption system working correctly');
      }

      // Test 2: Database connection and data retrieval
      console.log('\n📋 TEST 2: Database Connection');
      try {
        connection = await db.getAsync(
          'SELECT * FROM broker_connections WHERE id = ? AND user_id = ?',
          [connectionId, userId]
        );
        
        if (!connection) {
          issues.push('Broker connection not found in database');
          return { issues, warnings, connection: null };
        }
        console.log('✅ Connection found in database');
      } catch (dbError) {
        issues.push(`Database error: ${dbError.message}`);
        return { issues, warnings, connection: null };
      }

      // Test 3: Connection status
      console.log('\n📋 TEST 3: Connection Status');
      console.log(`   Active: ${connection.is_active}`);
      console.log(`   Authenticated: ${connection.is_authenticated}`);
      console.log(`   Broker: ${connection.broker_name}`);
      
      if (!connection.is_active) {
        issues.push('Connection is marked as inactive');
      }

      // Test 4: Credentials validation
      console.log('\n📋 TEST 4: Credentials Validation');
      
      if (!connection.api_key) {
        issues.push('API key is missing');
      } else {
        try {
          const decryptedApiKey = decryptData(connection.api_key);
          console.log(`✅ API key decrypted successfully (length: ${decryptedApiKey.length})`);
          console.log(`   Preview: ${decryptedApiKey.substring(0, 8)}...`);
        } catch (decryptError) {
          issues.push(`Failed to decrypt API key: ${decryptError.message}`);
        }
      }

      if (!connection.encrypted_api_secret && connection.broker_name.toLowerCase() !== 'angel') {
        warnings.push('API secret is missing (may be required for some operations)');
      }

      // Test 5: Access token validation
      console.log('\n📋 TEST 5: Access Token Validation');
      
      if (!connection.access_token) {
        issues.push('Access token is missing - authentication required');
      } else {
        try {
          const decryptedToken = decryptData(connection.access_token);
          console.log(`✅ Access token decrypted successfully (length: ${decryptedToken.length})`);
          console.log(`   Preview: ${decryptedToken.substring(0, 16)}...`);
          
          // Test 6: Token expiration
          console.log('\n📋 TEST 6: Token Expiration Check');
          const now = Math.floor(Date.now() / 1000);
          
          if (connection.access_token_expires_at) {
            const expiresAt = connection.access_token_expires_at;
            const timeToExpiry = expiresAt - now;
            
            console.log(`   Token expires at: ${new Date(expiresAt * 1000).toISOString()}`);
            console.log(`   Time to expiry: ${Math.floor(timeToExpiry / 60)} minutes`);
            
            if (timeToExpiry < 0) {
              issues.push('Access token has expired');
            } else if (timeToExpiry < 3600) {
              warnings.push(`Token expires soon (${Math.floor(timeToExpiry / 60)} minutes)`);
            }
          } else {
            warnings.push('Token expiration time not set');
          }
          
        } catch (decryptError) {
          issues.push(`Failed to decrypt access token: ${decryptError.message}`);
        }
      }

      // Test 7: Broker API connectivity
      if (issues.length === 0 && connection.access_token) {
        console.log('\n📋 TEST 7: Broker API Connectivity');
        try {
          let profileTest = false;
          
          if (connection.broker_name.toLowerCase() === 'zerodha') {
            const profile = await kiteService.getProfile(connectionId);
            if (profile && profile.user_id) {
              console.log(`✅ Zerodha API connected - User: ${profile.user_name} (${profile.user_id})`);
              profileTest = true;
            }
          } else if (connection.broker_name.toLowerCase() === 'upstox') {
            const profile = await upstoxService.getProfile(connectionId);
            if (profile) {
              console.log(`✅ Upstox API connected - User: ${profile.user_name || 'Unknown'}`);
              profileTest = true;
            }
          }
          
          if (!profileTest) {
            warnings.push('Could not test broker API connectivity for this broker type');
          }
          
        } catch (apiError) {
          issues.push(`Broker API connectivity failed: ${apiError.message}`);
        }
      }

      // Test 8: Database consistency
      console.log('\n📋 TEST 8: Database Consistency Check');
      try {
        const userExists = await db.getAsync('SELECT id FROM users WHERE id = ?', [userId]);
        if (!userExists) {
          issues.push('User not found in database');
        } else {
          console.log('✅ User exists in database');
        }
      } catch (dbError) {
        warnings.push(`Could not verify user existence: ${dbError.message}`);
      }

    } catch (error) {
      issues.push(`Unexpected error during diagnostics: ${error.message}`);
    }

    // Generate summary
    console.log('\n📊 ===== DIAGNOSTICS SUMMARY =====');
    console.log(`🔴 Issues: ${issues.length}`);
    console.log(`🟡 Warnings: ${warnings.length}`);
    
    if (issues.length > 0) {
      console.log('\n🔴 ISSUES FOUND:');
      issues.forEach((issue, index) => {
        console.log(`   ${index + 1}. ${issue}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('\n🟡 WARNINGS:');
      warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. ${warning}`);
      });
    }
    
    if (issues.length === 0 && warnings.length === 0) {
      console.log('✅ All tests passed - connection appears healthy');
    }
    
    console.log('🔍 ===== END DIAGNOSTICS =====\n');
    
    return {
      issues,
      warnings,
      connection,
      summary: {
        totalIssues: issues.length,
        totalWarnings: warnings.length,
        status: issues.length === 0 ? (warnings.length === 0 ? 'healthy' : 'warning') : 'error'
      }
    };
  }

  /**
   * Run diagnostics for all connections of a user
   */
  static async diagnoseAllConnections(userId) {
    console.log('🔍 ===== BATCH DIAGNOSTICS FOR ALL CONNECTIONS =====');
    
    try {
      const connections = await db.allAsync(
        'SELECT id, broker_name, connection_name FROM broker_connections WHERE user_id = ?',
        [userId]
      );
      
      console.log(`Found ${connections.length} connections for user ${userId}`);
      
      const results = [];
      
      for (const conn of connections) {
        console.log(`\n🔍 Diagnosing connection: ${conn.connection_name} (${conn.broker_name})`);
        const result = await this.diagnoseConnection(conn.id, userId);
        results.push({
          connectionId: conn.id,
          connectionName: conn.connection_name,
          brokerName: conn.broker_name,
          ...result
        });
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Batch diagnostics failed:', error);
      return [];
    }
  }

  /**
   * Quick health check - returns simple status
   */
  static async quickHealthCheck(connectionId, userId) {
    try {
      const connection = await db.getAsync(
        `SELECT 
          is_active, 
          access_token_expires_at,
          CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END as has_token
        FROM broker_connections 
        WHERE id = ? AND user_id = ?`,
        [connectionId, userId]
      );
      
      if (!connection) {
        return { status: 'not_found', message: 'Connection not found' };
      }
      
      if (!connection.is_active) {
        return { status: 'inactive', message: 'Connection is inactive' };
      }
      
      if (!connection.has_token) {
        return { status: 'needs_auth', message: 'Authentication required' };
      }
      
      const now = Math.floor(Date.now() / 1000);
      if (connection.access_token_expires_at && connection.access_token_expires_at < now) {
        return { status: 'token_expired', message: 'Token has expired' };
      }
      
      return { status: 'healthy', message: 'Connection appears healthy' };
      
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }
}

// CLI diagnostic tool
if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionId = process.argv[2];
  const userId = process.argv[3];
  
  if (!connectionId || !userId) {
    console.log('Usage: node brokerAuthDiagnostics.js <connectionId> <userId>');
    process.exit(1);
  }
  
  BrokerAuthDiagnostics.diagnoseConnection(connectionId, userId)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Diagnostics failed:', error);
      process.exit(1);
    });
}

export default BrokerAuthDiagnostics;