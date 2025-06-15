const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Middleware to check if user owns the resource or is admin
function requireOwnershipOrAdmin(req, res, next) {
  const resourceUserId = parseInt(req.params.userId || req.body.userId);
  const currentUserId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isAdmin && resourceUserId !== currentUserId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

// Generate JWT token
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

// Verify user exists and is active
function verifyUserExists(req, res, next) {
  const userId = req.user.id;
  
  db.get(
    'SELECT id, username, email, role, is_active FROM users WHERE id = ?',
    [userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }
      
      req.currentUser = user;
      next();
    }
  );
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireOwnershipOrAdmin,
  generateToken,
  verifyUserExists,
  JWT_SECRET
};
