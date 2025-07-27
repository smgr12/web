import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Generate a token for user ID 1 (assuming this user exists)
const token = jwt.sign(
  { userId: 1, email: 'test@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Generated JWT token:');
console.log(token);
console.log('\nUse this token in Authorization header as:');
console.log(`Bearer ${token}`);