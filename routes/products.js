const express = require('express');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../services/auditService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'products');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get all products with pagination and filtering
router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const category = req.query.category;
  const search = req.query.search;
  const sortBy = req.query.sortBy || 'created_at';
  const sortOrder = req.query.sortOrder || 'DESC';

  let whereClause = 'WHERE p.is_active = 1';
  let queryParams = [];

  if (category) {
    whereClause += ' AND p.category_id = ?';
    queryParams.push(category);
  }

  if (search) {
    whereClause += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    queryParams.push(`%${search}%`, `%${search}%`);
  }

  const query = `
    SELECT 
      p.*,
      c.name as category_name,
      i.quantity as stock_quantity,
      (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) as primary_image
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN inventory i ON p.id = i.product_id
    ${whereClause}
    ORDER BY p.${sortBy} ${sortOrder}
    LIMIT ? OFFSET ?
  `;

  queryParams.push(limit, offset);

  db.all(query, queryParams, (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      ${whereClause}
    `;

    db.get(countQuery, queryParams.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        products,
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

// Get single product by ID
router.get('/:id', (req, res) => {
  const productId = req.params.id;

  const query = `
    SELECT 
      p.*,
      c.name as category_name,
      i.quantity as stock_quantity,
      i.reserved_quantity,
      i.reorder_level
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN inventory i ON p.id = i.product_id
    WHERE p.id = ? AND p.is_active = 1
  `;

  db.get(query, [productId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Get product images
    db.all(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, is_primary DESC',
      [productId],
      (err, images) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        product.images = images;
        res.json({ product });
      }
    );
  });
});

// Create new product (Admin only)
router.post('/', authenticateToken, requireAdmin, upload.array('images', 5), (req, res) => {
  const {
    name, description, categoryId, price, costPrice, sku,
    weight, dimensions, stockQuantity, reorderLevel
  } = req.body;

  // Validation
  if (!name || !categoryId || !price || !sku) {
    return res.status(400).json({ error: 'Name, category, price, and SKU are required' });
  }

  // Check if SKU already exists
  db.get('SELECT id FROM products WHERE sku = ?', [sku], (err, existingProduct) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingProduct) {
      return res.status(409).json({ error: 'SKU already exists' });
    }

    // Insert product
    db.run(
      `INSERT INTO products (name, description, category_id, price, cost_price, sku, weight, dimensions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, categoryId, price, costPrice || null, sku, weight || null, dimensions || null],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to create product' });
        }

        const productId = this.lastID;

        // Insert inventory record
        db.run(
          'INSERT INTO inventory (product_id, quantity, reorder_level) VALUES (?, ?, ?)',
          [productId, stockQuantity || 0, reorderLevel || 10],
          (err) => {
            if (err) {
              console.error('Failed to create inventory record:', err);
            }
          }
        );

        // Handle image uploads
        if (req.files && req.files.length > 0) {
          req.files.forEach((file, index) => {
            const imageUrl = `/uploads/products/${file.filename}`;
            const isPrimary = index === 0 ? 1 : 0;

            db.run(
              'INSERT INTO product_images (product_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)',
              [productId, imageUrl, isPrimary, index],
              (err) => {
                if (err) {
                  console.error('Failed to save product image:', err);
                }
              }
            );
          });
        }

        // Log activity
        logActivity('products', productId, 'INSERT', null, {
          name, categoryId, price, sku
        }, req.user.id);

        res.status(201).json({
          message: 'Product created successfully',
          productId
        });
      }
    );
  });
});

// Update product (Admin only)
router.put('/:id', authenticateToken, requireAdmin, upload.array('images', 5), (req, res) => {
  const productId = req.params.id;
  const {
    name, description, categoryId, price, costPrice, sku,
    weight, dimensions, isActive
  } = req.body;

  // Get current product data for audit log
  db.get('SELECT * FROM products WHERE id = ?', [productId], (err, oldProduct) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!oldProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check if SKU already exists (excluding current product)
    if (sku && sku !== oldProduct.sku) {
      db.get('SELECT id FROM products WHERE sku = ? AND id != ?', [sku, productId], (err, existingProduct) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (existingProduct) {
          return res.status(409).json({ error: 'SKU already exists' });
        }

        updateProduct();
      });
    } else {
      updateProduct();
    }

    function updateProduct() {
      const updateFields = [];
      const updateValues = [];

      if (name !== undefined) {
        updateFields.push('name = ?');
        updateValues.push(name);
      }
      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description);
      }
      if (categoryId !== undefined) {
        updateFields.push('category_id = ?');
        updateValues.push(categoryId);
      }
      if (price !== undefined) {
        updateFields.push('price = ?');
        updateValues.push(price);
      }
      if (costPrice !== undefined) {
        updateFields.push('cost_price = ?');
        updateValues.push(costPrice);
      }
      if (sku !== undefined) {
        updateFields.push('sku = ?');
        updateValues.push(sku);
      }
      if (weight !== undefined) {
        updateFields.push('weight = ?');
        updateValues.push(weight);
      }
      if (dimensions !== undefined) {
        updateFields.push('dimensions = ?');
        updateValues.push(dimensions);
      }
      if (isActive !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(isActive ? 1 : 0);
      }

      if (updateFields.length === 0 && (!req.files || req.files.length === 0)) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      if (updateFields.length > 0) {
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(productId);

        const updateQuery = `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`;

        db.run(updateQuery, updateValues, function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to update product' });
          }

          handleImageUploads();
        });
      } else {
        handleImageUploads();
      }

      function handleImageUploads() {
        // Handle new image uploads
        if (req.files && req.files.length > 0) {
          req.files.forEach((file, index) => {
            const imageUrl = `/uploads/products/${file.filename}`;

            db.run(
              'INSERT INTO product_images (product_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?)',
              [productId, imageUrl, 0, index],
              (err) => {
                if (err) {
                  console.error('Failed to save product image:', err);
                }
              }
            );
          });
        }

        // Log activity
        logActivity('products', productId, 'UPDATE', oldProduct, req.body, req.user.id);

        res.json({ message: 'Product updated successfully' });
      }
    }
  });
});

// Delete product (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const productId = req.params.id;

  // Get product data for audit log
  db.get('SELECT * FROM products WHERE id = ?', [productId], (err, product) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Soft delete (set is_active to false)
    db.run(
      'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [productId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to delete product' });
        }

        // Log activity
        logActivity('products', productId, 'DELETE', product, null, req.user.id);

        res.json({ message: 'Product deleted successfully' });
      }
    );
  });
});

// Get product categories
router.get('/categories/list', (req, res) => {
  db.all(
    'SELECT * FROM categories WHERE is_active = 1 ORDER BY name',
    [],
    (err, categories) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({ categories });
    }
  );
});

module.exports = router;
