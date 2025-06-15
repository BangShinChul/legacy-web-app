const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { logActivity } = require('../services/auditService');

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, phone } = req.body;

    // Validation
    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    // Check if user already exists
    db.get(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email],
      async (err, existingUser) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (existingUser) {
          return res.status(409).json({ error: 'Username or email already exists' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new user
        db.run(
          `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [username, email, passwordHash, firstName, lastName, phone || null, 'customer'],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to create user' });
            }

            const userId = this.lastID;
            
            // Log registration
            logActivity('users', userId, 'INSERT', null, {
              username, email, firstName, lastName, role: 'customer'
            }, userId);

            // Generate token
            const user = {
              id: userId,
              username,
              email,
              role: 'customer'
            };
            const token = generateToken(user);

            res.status(201).json({
              message: 'User registered successfully',
              user: {
                id: userId,
                username,
                email,
                firstName,
                lastName,
                role: 'customer'
              },
              token
            });
          }
        );
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user by username or email
    db.get(
      'SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1',
      [username, username],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = generateToken(user);

        // Update last login (you might want to add this field to the users table)
        db.run(
          'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [user.id]
        );

        res.json({
          message: 'Login successful',
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role
          },
          token
        });
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, first_name, last_name, phone, role, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          role: user.role,
          createdAt: user.created_at
        }
      });
    }
  );
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get current user data
    db.get(
      'SELECT * FROM users WHERE id = ?',
      [userId],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        let updateFields = [];
        let updateValues = [];

        // Update basic info
        if (firstName) {
          updateFields.push('first_name = ?');
          updateValues.push(firstName);
        }
        if (lastName) {
          updateFields.push('last_name = ?');
          updateValues.push(lastName);
        }
        if (phone !== undefined) {
          updateFields.push('phone = ?');
          updateValues.push(phone);
        }

        // Handle password change
        if (newPassword) {
          if (!currentPassword) {
            return res.status(400).json({ error: 'Current password is required to change password' });
          }

          const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
          if (!isValidPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
          }

          const saltRounds = 10;
          const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
          updateFields.push('password_hash = ?');
          updateValues.push(newPasswordHash);
        }

        if (updateFields.length === 0) {
          return res.status(400).json({ error: 'No fields to update' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(userId);

        const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

        db.run(updateQuery, updateValues, function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to update profile' });
          }

          res.json({ message: 'Profile updated successfully' });
        });
      }
    );
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (client-side token removal, but we can log the activity)
router.post('/logout', authenticateToken, (req, res) => {
  // In a real application, you might want to blacklist the token
  // For now, we'll just return a success message
  res.json({ message: 'Logout successful' });
});

module.exports = router;
