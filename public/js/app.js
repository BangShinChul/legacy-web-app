// Global variables
let currentUser = null;
let currentSection = 'home';
let cartItems = [];
let products = [];
let currentPage = 1;
let totalPages = 1;

// API Base URL
const API_BASE_URL = `${window.location.protocol}//${window.location.host}/api`;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    checkAuthStatus();
});

// Initialize application
function initializeApp() {
    showSection('home');
    loadCategories();
}

// Setup event listeners
function setupEventListeners() {
    // Auth forms
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('checkout-form').addEventListener('submit', handleCheckout);
    
    // Payment method change
    document.getElementById('payment-method').addEventListener('change', handlePaymentMethodChange);
    
    // Search
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchProducts();
        }
    });
    
    // Category filter
    document.getElementById('category-filter').addEventListener('change', searchProducts);
}

// Check authentication status
function checkAuthStatus() {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
        try {
            currentUser = JSON.parse(userData);
            updateUIForLoggedInUser();
        } catch (error) {
            console.error('Error parsing user data:', error);
            logout();
        }
    }
}

// Update UI for logged in user
function updateUIForLoggedInUser() {
    document.getElementById('user-info').style.display = 'flex';
    document.getElementById('auth-buttons').style.display = 'none';
    document.getElementById('user-name').textContent = `${currentUser.firstName} ${currentUser.lastName}`;
    
    // Load user's cart
    loadCart();
}

// Update UI for logged out user
function updateUIForLoggedOutUser() {
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('auth-buttons').style.display = 'flex';
    currentUser = null;
    cartItems = [];
    updateCartCount();
}

// Show section
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
        currentSection = sectionName;
        
        // Load section-specific data
        switch (sectionName) {
            case 'products':
                loadProducts();
                break;
            case 'cart':
                loadCart();
                break;
            case 'orders':
                loadOrders();
                break;
        }
    }
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showToast('사용자명과 비밀번호를 입력해주세요.', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            currentUser = data.user;
            
            updateUIForLoggedInUser();
            showToast('로그인 성공!', 'success');
            showSection('home');
            
            // Clear form
            document.getElementById('login-form').reset();
        } else {
            showToast(data.error || '로그인에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('로그인 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Handle register
async function handleRegister(e) {
    e.preventDefault();
    
    const firstName = document.getElementById('register-firstname').value;
    const lastName = document.getElementById('register-lastname').value;
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const phone = document.getElementById('register-phone').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    
    // Validation
    if (!firstName || !lastName || !username || !email || !password) {
        showToast('필수 항목을 모두 입력해주세요.', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showToast('비밀번호가 일치하지 않습니다.', 'error');
        return;
    }
    
    if (password.length < 6) {
        showToast('비밀번호는 최소 6자 이상이어야 합니다.', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                firstName,
                lastName,
                username,
                email,
                phone,
                password
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            currentUser = data.user;
            
            updateUIForLoggedInUser();
            showToast('회원가입 성공!', 'success');
            showSection('home');
            
            // Clear form
            document.getElementById('register-form').reset();
        } else {
            showToast(data.error || '회원가입에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Register error:', error);
        showToast('회원가입 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userData');
    updateUIForLoggedOutUser();
    showToast('로그아웃되었습니다.', 'success');
    showSection('home');
}

// Load categories
async function loadCategories() {
    try {
        const response = await fetch(`${API_BASE_URL}/products/categories/list`);
        const data = await response.json();
        
        if (response.ok) {
            const categorySelect = document.getElementById('category-filter');
            categorySelect.innerHTML = '<option value="">모든 카테고리</option>';
            
            data.categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name;
                categorySelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Load products
async function loadProducts(page = 1) {
    showLoading(true);
    
    try {
        const category = document.getElementById('category-filter').value;
        const search = document.getElementById('search-input').value;
        
        let url = `${API_BASE_URL}/products?page=${page}&limit=12`;
        if (category) url += `&category=${category}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok) {
            products = data.products;
            currentPage = data.pagination.page;
            totalPages = data.pagination.pages;
            
            renderProducts();
            renderPagination();
        } else {
            showToast('상품을 불러오는데 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Error loading products:', error);
        showToast('상품을 불러오는 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Render products
function renderProducts() {
    const productsGrid = document.getElementById('products-grid');
    
    if (products.length === 0) {
        productsGrid.innerHTML = '<div class="no-products">상품이 없습니다.</div>';
        return;
    }
    
    productsGrid.innerHTML = products.map(product => `
        <div class="product-card">
            <div class="product-image">
                ${product.primary_image ? 
                    `<img src="${product.primary_image}" alt="${product.name}">` : 
                    '<i class="fas fa-image"></i>'
                }
            </div>
            <div class="product-info">
                <h3>${escapeHtml(product.name)}</h3>
                <p>${escapeHtml(product.description || '상품 설명이 없습니다.')}</p>
                <div class="product-price">₩${formatPrice(product.price)}</div>
                <div class="product-actions">
                    <button onclick="addToCart(${product.id})" class="btn btn-primary" ${!currentUser ? 'disabled' : ''}>
                        <i class="fas fa-cart-plus"></i> 장바구니
                    </button>
                    <button onclick="viewProduct(${product.id})" class="btn btn-outline">
                        <i class="fas fa-eye"></i> 상세보기
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// Search products
function searchProducts() {
    currentPage = 1;
    loadProducts(1);
}

// Add to cart
async function addToCart(productId, quantity = 1) {
    if (!currentUser) {
        showToast('로그인이 필요합니다.', 'error');
        showSection('login');
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/cart`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                productId,
                quantity
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast('장바구니에 추가되었습니다.', 'success');
            loadCart(); // Refresh cart
        } else {
            showToast(data.error || '장바구니 추가에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        showToast('장바구니 추가 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Load cart
async function loadCart() {
    if (!currentUser) {
        cartItems = [];
        updateCartCount();
        renderCart();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/cart`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            cartItems = data.cartItems || [];
            updateCartCount();
            renderCart();
        }
    } catch (error) {
        console.error('Error loading cart:', error);
    }
}

// Update cart count
function updateCartCount() {
    const cartCount = document.getElementById('cart-count');
    const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    cartCount.textContent = totalItems;
}

// Render cart
function renderCart() {
    const cartItemsContainer = document.getElementById('cart-items');
    const cartSummaryContainer = document.getElementById('cart-summary');
    
    if (cartItems.length === 0) {
        cartItemsContainer.innerHTML = '<div class="empty-cart">장바구니가 비어있습니다.</div>';
        cartSummaryContainer.innerHTML = '';
        return;
    }
    
    // Render cart items
    cartItemsContainer.innerHTML = cartItems.map(item => `
        <div class="cart-item">
            <div class="cart-item-image">
                ${item.product_image ? 
                    `<img src="${item.product_image}" alt="${item.product_name}">` : 
                    '<i class="fas fa-image"></i>'
                }
            </div>
            <div class="cart-item-info">
                <h4>${escapeHtml(item.product_name)}</h4>
                <div class="cart-item-price">₩${formatPrice(item.price)}</div>
                <div class="cart-item-controls">
                    <button class="quantity-btn" onclick="updateCartItemQuantity(${item.id}, ${item.quantity - 1})">-</button>
                    <input type="number" class="quantity-input" value="${item.quantity}" min="1" 
                           onchange="updateCartItemQuantity(${item.id}, this.value)">
                    <button class="quantity-btn" onclick="updateCartItemQuantity(${item.id}, ${item.quantity + 1})">+</button>
                </div>
                <button onclick="removeFromCart(${item.id})" class="btn btn-danger btn-sm">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>
    `).join('');
    
    // Calculate totals
    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 50000 ? 0 : 3000; // Free shipping over 50,000 KRW
    const total = subtotal + shipping;
    
    // Render cart summary
    cartSummaryContainer.innerHTML = `
        <h3>주문 요약</h3>
        <div class="summary-row">
            <span>소계:</span>
            <span>₩${formatPrice(subtotal)}</span>
        </div>
        <div class="summary-row">
            <span>배송비:</span>
            <span>${shipping === 0 ? '무료' : '₩' + formatPrice(shipping)}</span>
        </div>
        <div class="summary-row total">
            <span>총계:</span>
            <span>₩${formatPrice(total)}</span>
        </div>
        <button onclick="proceedToCheckout()" class="btn btn-primary btn-full">
            <i class="fas fa-credit-card"></i> 주문하기
        </button>
    `;
}

// Update cart item quantity
async function updateCartItemQuantity(itemId, newQuantity) {
    if (newQuantity < 1) {
        removeFromCart(itemId);
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/cart/${itemId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ quantity: parseInt(newQuantity) })
        });
        
        if (response.ok) {
            loadCart(); // Refresh cart
        } else {
            const data = await response.json();
            showToast(data.error || '수량 변경에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Error updating cart item:', error);
        showToast('수량 변경 중 오류가 발생했습니다.', 'error');
    }
}

// Remove from cart
async function removeFromCart(itemId) {
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUser.id}/cart/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            showToast('상품이 장바구니에서 제거되었습니다.', 'success');
            loadCart(); // Refresh cart
        } else {
            const data = await response.json();
            showToast(data.error || '상품 제거에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Error removing from cart:', error);
        showToast('상품 제거 중 오류가 발생했습니다.', 'error');
    }
}

// Proceed to checkout
function proceedToCheckout() {
    if (!currentUser) {
        showToast('로그인이 필요합니다.', 'error');
        showSection('login');
        return;
    }
    
    if (cartItems.length === 0) {
        showToast('장바구니가 비어있습니다.', 'error');
        return;
    }
    
    // Show checkout modal
    document.getElementById('checkout-modal').style.display = 'block';
    
    // Populate checkout summary
    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal > 50000 ? 0 : 3000;
    const total = subtotal + shipping;
    
    document.getElementById('checkout-summary').innerHTML = `
        <div class="summary-row">
            <span>상품 ${cartItems.length}개:</span>
            <span>₩${formatPrice(subtotal)}</span>
        </div>
        <div class="summary-row">
            <span>배송비:</span>
            <span>${shipping === 0 ? '무료' : '₩' + formatPrice(shipping)}</span>
        </div>
        <div class="summary-row total">
            <span>총 결제금액:</span>
            <span>₩${formatPrice(total)}</span>
        </div>
    `;
}

// Close checkout modal
function closeCheckoutModal() {
    document.getElementById('checkout-modal').style.display = 'none';
    document.getElementById('checkout-form').reset();
    document.getElementById('card-details').style.display = 'none';
    document.getElementById('paypal-details').style.display = 'none';
}

// Handle payment method change
function handlePaymentMethodChange() {
    const paymentMethod = document.getElementById('payment-method').value;
    const cardDetails = document.getElementById('card-details');
    const paypalDetails = document.getElementById('paypal-details');
    
    // Hide all payment details
    cardDetails.style.display = 'none';
    paypalDetails.style.display = 'none';
    
    // Show relevant payment details
    if (paymentMethod === 'credit_card' || paymentMethod === 'debit_card') {
        cardDetails.style.display = 'block';
    } else if (paymentMethod === 'paypal') {
        paypalDetails.style.display = 'block';
    }
}

// Handle checkout
async function handleCheckout(e) {
    e.preventDefault();
    
    if (cartItems.length === 0) {
        showToast('장바구니가 비어있습니다.', 'error');
        return;
    }
    
    // Get form data
    const shippingAddress = {
        streetAddress: document.getElementById('shipping-street').value,
        city: document.getElementById('shipping-city').value,
        state: document.getElementById('shipping-state').value,
        postalCode: document.getElementById('shipping-postal').value,
        country: document.getElementById('shipping-country').value
    };
    
    const paymentMethod = document.getElementById('payment-method').value;
    
    // Validate required fields
    if (!shippingAddress.streetAddress || !shippingAddress.city || !shippingAddress.state || 
        !shippingAddress.postalCode || !paymentMethod) {
        showToast('필수 항목을 모두 입력해주세요.', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        // Create order
        const orderData = {
            items: cartItems.map(item => ({
                productId: item.product_id,
                quantity: item.quantity
            })),
            shippingAddress,
            billingAddress: shippingAddress, // Same as shipping for simplicity
            paymentMethod
        };
        
        const orderResponse = await fetch(`${API_BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(orderData)
        });
        
        const orderResult = await orderResponse.json();
        
        if (orderResponse.ok) {
            // Process payment
            const paymentDetails = getPaymentDetails(paymentMethod);
            
            const paymentResponse = await fetch(`${API_BASE_URL}/payments/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    orderId: orderResult.orderId,
                    paymentMethod,
                    paymentDetails
                })
            });
            
            const paymentResult = await paymentResponse.json();
            
            if (paymentResponse.ok) {
                showToast('주문이 완료되었습니다!', 'success');
                closeCheckoutModal();
                loadCart(); // Clear cart
                showSection('orders');
            } else {
                showToast(paymentResult.error || '결제에 실패했습니다.', 'error');
            }
        } else {
            showToast(orderResult.error || '주문 생성에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Checkout error:', error);
        showToast('주문 처리 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Get payment details based on method
function getPaymentDetails(paymentMethod) {
    if (paymentMethod === 'credit_card' || paymentMethod === 'debit_card') {
        return {
            cardNumber: document.getElementById('card-number').value,
            expiryMonth: document.getElementById('card-expiry-month').value,
            expiryYear: document.getElementById('card-expiry-year').value,
            cvv: document.getElementById('card-cvv').value,
            cardholderName: document.getElementById('card-name').value
        };
    } else if (paymentMethod === 'paypal') {
        return {
            email: document.getElementById('paypal-email').value
        };
    }
    return {};
}

// Load orders
async function loadOrders() {
    if (!currentUser) {
        document.getElementById('orders-content').innerHTML = '<div class="no-orders">로그인이 필요합니다.</div>';
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/orders`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            renderOrders(data.orders);
        } else {
            showToast('주문 내역을 불러오는데 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        showToast('주문 내역을 불러오는 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Render orders
function renderOrders(orders) {
    const ordersContent = document.getElementById('orders-content');
    
    if (orders.length === 0) {
        ordersContent.innerHTML = '<div class="no-orders">주문 내역이 없습니다.</div>';
        return;
    }
    
    ordersContent.innerHTML = orders.map(order => `
        <div class="order-card">
            <div class="order-header">
                <div class="order-number">주문번호: ${order.order_number}</div>
                <div class="order-status ${order.status}">${getStatusText(order.status)}</div>
            </div>
            <div class="order-info">
                <p>주문일: ${formatDate(order.created_at)}</p>
                <p>상품 ${order.item_count}개</p>
            </div>
            <div class="order-total">총 결제금액: ₩${formatPrice(order.total_amount)}</div>
            <div class="order-actions">
                <button onclick="viewOrderDetails(${order.id})" class="btn btn-outline">상세보기</button>
                ${order.status === 'pending' ? 
                    `<button onclick="cancelOrder(${order.id})" class="btn btn-danger">주문취소</button>` : 
                    ''
                }
            </div>
        </div>
    `).join('');
}

// Get status text in Korean
function getStatusText(status) {
    const statusMap = {
        'pending': '대기중',
        'confirmed': '확인됨',
        'processing': '처리중',
        'shipped': '배송중',
        'delivered': '배송완료',
        'cancelled': '취소됨'
    };
    return statusMap[status] || status;
}

// Render pagination
function renderPagination() {
    const paginationContainer = document.getElementById('products-pagination');
    
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    
    // Previous button
    paginationHTML += `
        <button onclick="loadProducts(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i> 이전
        </button>
    `;
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <button onclick="loadProducts(${i})" ${i === currentPage ? 'class="active"' : ''}>
                ${i}
            </button>
        `;
    }
    
    // Next button
    paginationHTML += `
        <button onclick="loadProducts(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
            다음 <i class="fas fa-chevron-right"></i>
        </button>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

// View product details (placeholder)
function viewProduct(productId) {
    showToast('상품 상세보기 기능은 준비 중입니다.', 'info');
}

// View order details (placeholder)
function viewOrderDetails(orderId) {
    showToast('주문 상세보기 기능은 준비 중입니다.', 'info');
}

// Cancel order
async function cancelOrder(orderId) {
    if (!confirm('정말로 주문을 취소하시겠습니까?')) {
        return;
    }
    
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/orders/${orderId}/cancel`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            showToast('주문이 취소되었습니다.', 'success');
            loadOrders(); // Refresh orders
        } else {
            const data = await response.json();
            showToast(data.error || '주문 취소에 실패했습니다.', 'error');
        }
    } catch (error) {
        console.error('Cancel order error:', error);
        showToast('주문 취소 중 오류가 발생했습니다.', 'error');
    } finally {
        showLoading(false);
    }
}

// Utility functions
function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div>${escapeHtml(message)}</div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatPrice(price) {
    return new Intl.NumberFormat('ko-KR').format(price);
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('ko-KR');
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('checkout-modal');
    if (event.target === modal) {
        closeCheckoutModal();
    }
}
