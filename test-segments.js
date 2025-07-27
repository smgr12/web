import axios from 'axios';

async function testSegments() {
  try {
    const response = await axios.get('http://localhost:3001/api/symbols/segments', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc1Mjc0OTg2NCwiZXhwIjoxNzUyNzUzNDY0fQ.RIJ_BEOpHQSx9DT4HMEhqZMXRLiylxu7DkoZeiAxhgI'
      }
    });
    
    console.log('Available segments with improved names:');
    response.data.data.forEach(segment => {
      console.log(`- ${segment.display_name} (${segment.symbol_count.toLocaleString()} symbols)`);
    });
    
    // Test segment-specific search
    console.log('\nTesting segment-specific search for "REL" in NSE:');
    const searchResponse = await axios.get('http://localhost:3001/api/symbols/search/segment', {
      params: {
        q: 'REL',
        segment: 'NSE',
        exchange: 'NSE',
        limit: 5
      },
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc1Mjc0OTg2NCwiZXhwIjoxNzUyNzUzNDY0fQ.RIJ_BEOpHQSx9DT4HMEhqZMXRLiylxu7DkoZeiAxhgI'
      }
    });
    
    console.log('Search results:');
    searchResponse.data.data.forEach(symbol => {
      console.log(`  ${symbol.symbol} - ${symbol.name || 'N/A'} (${symbol.instrument_type})`);
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testSegments();