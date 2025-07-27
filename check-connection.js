#!/usr/bin/env node

import { db } from './server/database/init.js';

async function checkConnection() {
  try {
    console.log('Checking connection ID 3...');
    
    const connection = await db.getAsync(
      'SELECT id, broker_name, connection_name, api_key, encrypted_api_secret, is_active, user_id FROM broker_connections WHERE id = 3'
    );
    
    if (connection) {
      console.log('Connection found:');
      console.log('ID:', connection.id);
      console.log('Broker:', connection.broker_name);
      console.log('Name:', connection.connection_name);
      console.log('User ID:', connection.user_id);
      console.log('Is Active:', connection.is_active);
      console.log('Has API Key:', !!connection.api_key);
      console.log('Has API Secret:', !!connection.encrypted_api_secret);
      
      if (connection.api_key) {
        console.log('API Key length:', connection.api_key.length);
      }
      
      if (connection.encrypted_api_secret) {
        console.log('Encrypted API Secret length:', connection.encrypted_api_secret.length);
      }
      
      // Try to decrypt the API key to see what it contains
      if (connection.api_key) {
        try {
          const { decryptData } = await import('./server/utils/encryption.js');
          const decryptedApiKey = decryptData(connection.api_key);
          console.log('Decrypted API Key (first 10 chars):', decryptedApiKey.substring(0, 10) + '...');
          console.log('Decrypted API Key length:', decryptedApiKey.length);
        } catch (error) {
          console.log('Failed to decrypt API key:', error.message);
        }
      }
    } else {
      console.log('Connection not found');
    }
    
    // Also check all Shoonya connections
    console.log('\nAll Shoonya connections:');
    const shoonyaConnections = await db.allAsync(
      'SELECT id, broker_name, connection_name, api_key, encrypted_api_secret, is_active, user_id FROM broker_connections WHERE broker_name = ?',
      ['Shoonya']
    );
    
    console.log('Found', shoonyaConnections.length, 'Shoonya connections');
    shoonyaConnections.forEach(conn => {
      console.log(`- ID: ${conn.id}, Name: ${conn.connection_name}, Active: ${conn.is_active}, Has API Key: ${!!conn.api_key}, Has API Secret: ${!!conn.encrypted_api_secret}`);
    });
    
  } catch (error) {
    console.error('Error checking connection:', error);
  } finally {
    process.exit(0);
  }
}

checkConnection();
