const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin, requireOwnershipOrAdmin } = require('../middleware/auth');
const { logActivity } = require('../services/auditService');

const router = express.Router();

// Get all users (Admin only)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const search = req.query.search;
  const role = req.query.role;

  let whereClause = 'WHERE 1=1';
  let queryParams = [];

  if (search) {
    whereClause += ' AND (username LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
    queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (role) {
    whereClause += ' AND role = ?';
    queryParams.push(role);
  }

  const query = `
    SELECT id, username, email, first_name, last_name, phone, role, is_active, created_at
    FROM users
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
    
    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        users,
        pagination: {
          page,
          limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
});

// Get user by ID
router.get('/:id', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;

  db.get(
    'SELECT id, username, email, first_name, last_name, phone, role, is_active, created_at FROM users WHERE id = ?',
    [userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get user addresses
      db.all(
        'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
        [userId],
        (err, addresses) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          user.addresses = addresses;
          res.json({ user });
        }
      );
    }
  );
});

// Update user (Admin or user themselves)
router.put('/:id', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const { firstName, lastName, phone, role, isActive } = req.body;
  const isAdmin = req.user.role === 'admin';

  // Get current user data
  db.get('SELECT * FROM users WHERE id = ?', [userId], (err, oldUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!oldUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateFields = [];
    const updateValues = [];

    if (firstName !== undefined) {
      updateFields.push('first_name = ?');
      updateValues.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push('last_name = ?');
      updateValues.push(lastName);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      updateValues.push(phone);
    }

    // Only admin can update role and active status
    if (isAdmin) {
      if (role !== undefined) {
        updateFields.push('role = ?');
        updateValues.push(role);
      }
      if (isActive !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(isActive ? 1 : 0);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId);

    const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

    db.run(updateQuery, updateValues, function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update user' });
      }

      // Log activity
      logActivity('users', userId, 'UPDATE', oldUser, req.body, req.user.id);

      res.json({ message: 'User updated successfully' });
    });
  });
});

// Add user address
router.post('/:id/addresses', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const {
    addressType, streetAddress, city, state, postalCode, country, isDefault
  } = req.body;

  if (!streetAddress || !city || !state || !postalCode || !country) {
    return res.status(400).json({ error: 'All address fields are required' });
  }

  // If this is set as default, unset other default addresses
  if (isDefault) {
    db.run(
      'UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND address_type = ?',
      [userId, addressType || 'shipping']
    );
  }

  db.run(
    `INSERT INTO user_addresses (
      user_id, address_type, street_address, city, state, postal_code, country, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, addressType || 'shipping', streetAddress, city, state, postalCode, country, isDefault ? 1 : 0],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add address' });
      }

      res.status(201).json({
        message: 'Address added successfully',
        addressId: this.lastID
      });
    }
  );
});

// Update user address
router.put('/:id/addresses/:addressId', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const addressId = req.params.addressId;
  const {
    addressType, streetAddress, city, state, postalCode, country, isDefault
  } = req.body;

  // Verify address belongs to user
  db.get(
    'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?',
    [addressId, userId],
    (err, address) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!address) {
        return res.status(404).json({ error: 'Address not found' });
      }

      // If this is set as default, unset other default addresses
      if (isDefault) {
        db.run(
          'UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND address_type = ? AND id != ?',
          [userId, addressType || address.address_type, addressId]
        );
      }

      const updateFields = [];
      const updateValues = [];

      if (addressType !== undefined) {
        updateFields.push('address_type = ?');
        updateValues.push(addressType);
      }
      if (streetAddress !== undefined) {
        updateFields.push('street_address = ?');
        updateValues.push(streetAddress);
      }
      if (city !== undefined) {
        updateFields.push('city = ?');
        updateValues.push(city);
      }
      if (state !== undefined) {
        updateFields.push('state = ?');
        updateValues.push(state);
      }
      if (postalCode !== undefined) {
        updateFields.push('postal_code = ?');
        updateValues.push(postalCode);
      }
      if (country !== undefined) {
        updateFields.push('country = ?');
        updateValues.push(country);
      }
      if (isDefault !== undefined) {
        updateFields.push('is_default = ?');
        updateValues.push(isDefault ? 1 : 0);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updateValues.push(addressId);
      const updateQuery = `UPDATE user_addresses SET ${updateFields.join(', ')} WHERE id = ?`;

      db.run(updateQuery, updateValues, function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to update address' });
        }

        res.json({ message: 'Address updated successfully' });
      });
    }
  );
});

// Delete user address
router.delete('/:id/addresses/:addressId', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const addressId = req.params.addressId;

  // Verify address belongs to user
  db.get(
    'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?',
    [addressId, userId],
    (err, address) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!address) {
        return res.status(404).json({ error: 'Address not found' });
      }

      db.run(
        'DELETE FROM user_addresses WHERE id = ?',
        [addressId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to delete address' });
          }

          res.json({ message: 'Address deleted successfully' });
        }
      );
    }
  );
});

// Get user's shopping cart
router.get('/:id/cart', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;

  const query = `
    SELECT 
      sc.*,
      p.name as product_name,
      p.price,
      p.sku,
      i.quantity as stock_quantity,
      (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as product_image
    FROM shopping_cart sc
    LEFT JOIN products p ON sc.product_id = p.id
    LEFT JOIN inventory i ON p.id = i.product_id
    WHERE sc.user_id = ? AND p.is_active = 1
    ORDER BY sc.created_at DESC
  `;

  db.all(query, [userId], (err, cartItems) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const totalAmount = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    res.json({
      cartItems,
      summary: {
        itemCount: cartItems.length,
        totalQuantity: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        totalAmount
      }
    });
  });
});

// Add item to cart
router.post('/:id/cart', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const { productId, quantity } = req.body;

  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Valid product ID and quantity are required' });
  }

  // Check if product exists and is active
  db.get(
    'SELECT p.*, i.quantity as stock_quantity FROM products p LEFT JOIN inventory i ON p.id = i.product_id WHERE p.id = ? AND p.is_active = 1',
    [productId],
    (err, product) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (product.stock_quantity < quantity) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }

      // Check if item already in cart
      db.get(
        'SELECT * FROM shopping_cart WHERE user_id = ? AND product_id = ?',
        [userId, productId],
        (err, existingItem) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          if (existingItem) {
            // Update quantity
            const newQuantity = existingItem.quantity + quantity;
            if (product.stock_quantity < newQuantity) {
              return res.status(400).json({ error: 'Insufficient stock for requested quantity' });
            }

            db.run(
              'UPDATE shopping_cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [newQuantity, existingItem.id],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Failed to update cart' });
                }

                res.json({ message: 'Cart updated successfully' });
              }
            );
          } else {
            // Add new item
            db.run(
              'INSERT INTO shopping_cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
              [userId, productId, quantity],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Failed to add to cart' });
                }

                res.status(201).json({ message: 'Item added to cart successfully' });
              }
            );
          }
        }
      );
    }
  );
});

// Update cart item quantity
router.put('/:id/cart/:itemId', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const itemId = req.params.itemId;
  const { quantity } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Valid quantity is required' });
  }

  // Verify cart item belongs to user
  db.get(
    'SELECT sc.*, p.name, i.quantity as stock_quantity FROM shopping_cart sc LEFT JOIN products p ON sc.product_id = p.id LEFT JOIN inventory i ON p.id = i.product_id WHERE sc.id = ? AND sc.user_id = ?',
    [itemId, userId],
    (err, cartItem) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!cartItem) {
        return res.status(404).json({ error: 'Cart item not found' });
      }

      if (cartItem.stock_quantity < quantity) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }

      db.run(
        'UPDATE shopping_cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantity, itemId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to update cart item' });
          }

          res.json({ message: 'Cart item updated successfully' });
        }
      );
    }
  );
});

// Remove item from cart
router.delete('/:id/cart/:itemId', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;
  const itemId = req.params.itemId;

  // Verify cart item belongs to user
  db.get(
    'SELECT * FROM shopping_cart WHERE id = ? AND user_id = ?',
    [itemId, userId],
    (err, cartItem) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!cartItem) {
        return res.status(404).json({ error: 'Cart item not found' });
      }

      db.run(
        'DELETE FROM shopping_cart WHERE id = ?',
        [itemId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to remove cart item' });
          }

          res.json({ message: 'Cart item removed successfully' });
        }
      );
    }
  );
});

// Clear user's cart
router.delete('/:id/cart', authenticateToken, requireOwnershipOrAdmin, (req, res) => {
  const userId = req.params.id;

  db.run(
    'DELETE FROM shopping_cart WHERE user_id = ?',
    [userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear cart' });
      }

      res.json({ message: 'Cart cleared successfully' });
    }
  );
});

module.exports = router;
