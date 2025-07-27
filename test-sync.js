import axios from 'axios';

async function testSymbolSync() {
  try {
    console.log('Testing symbol sync...');
    
    // Test server health
    const healthResponse = await axios.get('http://localhost:3001/api/health');
    console.log('Server health:', healthResponse.data);
    
    // Sync Zerodha symbols
    console.log('Starting Zerodha symbol sync...');
    const syncResponse = await axios.post('http://localhost:3001/api/symbols/sync/zerodha', {}, {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc1Mjc0OTg2NCwiZXhwIjoxNzUyNzUzNDY0fQ.RIJ_BEOpHQSx9DT4HMEhqZMXRLiylxu7DkoZeiAxhgI'
      }
    });
    console.log('Sync response:', syncResponse.data);
    
    // Wait a bit for sync to process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check sync status
    const statusResponse = await axios.get('http://localhost:3001/api/symbols/sync-status', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc1Mjc0OTg2NCwiZXhwIjoxNzUyNzUzNDY0fQ.RIJ_BEOpHQSx9DT4HMEhqZMXRLiylxu7DkoZeiAxhgI'
      }
    });
    console.log('Sync status:', statusResponse.data);
    
    // Get available segments
    const segmentsResponse = await axios.get('http://localhost:3001/api/symbols/segments', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc1Mjc0OTg2NCwiZXhwIjoxNzUyNzUzNDY0fQ.RIJ_BEOpHQSx9DT4HMEhqZMXRLiylxu7DkoZeiAxhgI'
      }
    });
    console.log('Available segments:', segmentsResponse.data);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testSymbolSync();