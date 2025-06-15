const { db, initializeDatabase } = require('../config/database');
const bcrypt = require('bcryptjs');

async function initializeSampleData() {
  console.log('Initializing sample data...');

  try {
    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    db.run(
      `INSERT OR IGNORE INTO users (username, email, password_hash, first_name, last_name, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['admin', 'admin@example.com', adminPassword, 'Admin', 'User', 'admin']
    );

    // Create sample customer
    const customerPassword = await bcrypt.hash('customer123', 10);
    db.run(
      `INSERT OR IGNORE INTO users (username, email, password_hash, first_name, last_name, phone, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['customer', 'customer@example.com', customerPassword, '홍', '길동', '010-1234-5678', 'customer']
    );

    // Create categories
    const categories = [
      { name: '전자제품', description: '스마트폰, 노트북, 태블릿 등' },
      { name: '의류', description: '남성복, 여성복, 아동복' },
      { name: '도서', description: '소설, 전문서적, 만화' },
      { name: '생활용품', description: '주방용품, 청소용품, 욕실용품' },
      { name: '스포츠', description: '운동복, 운동기구, 스포츠용품' }
    ];

    for (const category of categories) {
      db.run(
        'INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)',
        [category.name, category.description]
      );
    }

    // Wait for categories to be inserted
    setTimeout(() => {
      // Create sample products
      const products = [
        {
          name: 'iPhone 15 Pro',
          description: '최신 A17 Pro 칩셋을 탑재한 프리미엄 스마트폰',
          category_id: 1,
          price: 1490000,
          cost_price: 1200000,
          sku: 'IPHONE15PRO-128',
          weight: 0.187,
          dimensions: '146.6 x 70.6 x 8.25 mm'
        },
        {
          name: 'MacBook Air M3',
          description: '13인치 M3 칩 탑재 울트라북',
          category_id: 1,
          price: 1590000,
          cost_price: 1300000,
          sku: 'MBA-M3-13-256',
          weight: 1.24,
          dimensions: '304 x 215 x 11.3 mm'
        },
        {
          name: '나이키 에어맥스',
          description: '편안한 착용감의 러닝화',
          category_id: 5,
          price: 159000,
          cost_price: 80000,
          sku: 'NIKE-AIRMAX-270',
          weight: 0.5,
          dimensions: '280mm'
        },
        {
          name: '삼성 갤럭시 S24',
          description: 'AI 기능이 강화된 플래그십 스마트폰',
          category_id: 1,
          price: 1155000,
          cost_price: 950000,
          sku: 'GALAXY-S24-256',
          weight: 0.167,
          dimensions: '147 x 70.6 x 7.6 mm'
        },
        {
          name: '유니클로 히트텍',
          description: '발열 기능성 이너웨어',
          category_id: 2,
          price: 19900,
          cost_price: 10000,
          sku: 'UNIQLO-HEATTECH-L',
          weight: 0.2,
          dimensions: 'L 사이즈'
        },
        {
          name: '해리포터 전집',
          description: '전 7권 세트 (양장본)',
          category_id: 3,
          price: 89000,
          cost_price: 60000,
          sku: 'HARRYPOTTER-SET-7',
          weight: 2.5,
          dimensions: '150 x 220 x 180 mm'
        },
        {
          name: '다이슨 청소기 V15',
          description: '무선 스틱 청소기',
          category_id: 4,
          price: 899000,
          cost_price: 650000,
          sku: 'DYSON-V15-DETECT',
          weight: 3.1,
          dimensions: '1257 x 250 x 166 mm'
        },
        {
          name: '아디다스 트레이닝복',
          description: '3-Stripes 트랙수트',
          category_id: 5,
          price: 129000,
          cost_price: 70000,
          sku: 'ADIDAS-3STRIPES-L',
          weight: 0.8,
          dimensions: 'L 사이즈'
        }
      ];

      for (const product of products) {
        db.run(
          `INSERT OR IGNORE INTO products (name, description, category_id, price, cost_price, sku, weight, dimensions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [product.name, product.description, product.category_id, product.price, 
           product.cost_price, product.sku, product.weight, product.dimensions],
          function(err) {
            if (!err && this.lastID) {
              // Add inventory for each product
              const stockQuantity = Math.floor(Math.random() * 100) + 10; // 10-109 items
              db.run(
                'INSERT OR IGNORE INTO inventory (product_id, quantity, reorder_level, warehouse_location) VALUES (?, ?, ?, ?)',
                [this.lastID, stockQuantity, 10, 'Warehouse A']
              );
            }
          }
        );
      }

      console.log('Sample data initialized successfully!');
      console.log('\nDefault accounts:');
      console.log('Admin: admin / admin123');
      console.log('Customer: customer / customer123');
      
      // Close database connection
      setTimeout(() => {
        db.close((err) => {
          if (err) {
            console.error('Error closing database:', err.message);
          } else {
            console.log('Database connection closed.');
          }
          process.exit(0);
        });
      }, 2000);
    }, 1000);

  } catch (error) {
    console.error('Error initializing sample data:', error);
    process.exit(1);
  }
}

// Initialize database and sample data
async function main() {
  try {
    await initializeDatabase();
    await initializeSampleData();
  } catch (error) {
    console.error('Initialization failed:', error);
    process.exit(1);
  }
}

main();
