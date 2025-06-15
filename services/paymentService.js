/**
 * Payment Service - Simulates payment processing
 * In a real application, this would integrate with actual payment gateways
 * like Stripe, PayPal, Square, etc.
 */

const crypto = require('crypto');

/**
 * Simulate payment processing delay
 * @param {number} ms - Milliseconds to delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a mock transaction ID
 * @returns {string} Transaction ID
 */
function generateTransactionId() {
  return 'txn_' + crypto.randomBytes(16).toString('hex');
}

/**
 * Validate payment details based on payment method
 * @param {string} paymentMethod - Payment method
 * @param {object} paymentDetails - Payment details
 * @returns {object} Validation result
 */
function validatePaymentDetails(paymentMethod, paymentDetails) {
  const errors = [];

  switch (paymentMethod) {
    case 'credit_card':
    case 'debit_card':
      if (!paymentDetails.cardNumber || paymentDetails.cardNumber.length < 13) {
        errors.push('Invalid card number');
      }
      if (!paymentDetails.expiryMonth || !paymentDetails.expiryYear) {
        errors.push('Invalid expiry date');
      }
      if (!paymentDetails.cvv || paymentDetails.cvv.length < 3) {
        errors.push('Invalid CVV');
      }
      if (!paymentDetails.cardholderName) {
        errors.push('Cardholder name is required');
      }
      break;

    case 'paypal':
      if (!paymentDetails.email) {
        errors.push('PayPal email is required');
      }
      break;

    case 'bank_transfer':
      if (!paymentDetails.accountNumber || !paymentDetails.routingNumber) {
        errors.push('Bank account details are required');
      }
      break;

    default:
      errors.push('Unsupported payment method');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Simulate different payment outcomes based on test data
 * @param {object} paymentDetails - Payment details
 * @returns {string} Payment outcome
 */
function simulatePaymentOutcome(paymentDetails) {
  // Simulate different scenarios based on card number or email
  if (paymentDetails.cardNumber) {
    const lastFour = paymentDetails.cardNumber.slice(-4);
    
    // Test scenarios
    if (lastFour === '0000') return 'declined';
    if (lastFour === '0001') return 'insufficient_funds';
    if (lastFour === '0002') return 'expired_card';
    if (lastFour === '0003') return 'invalid_card';
    if (lastFour === '0004') return 'processing_error';
    
    // Random failure for testing (5% chance)
    if (Math.random() < 0.05) return 'network_error';
  }

  if (paymentDetails.email && paymentDetails.email.includes('fail')) {
    return 'declined';
  }

  return 'success';
}

/**
 * Process payment
 * @param {object} paymentData - Payment data
 * @returns {Promise<object>} Payment result
 */
async function processPayment(paymentData) {
  const {
    amount,
    currency = 'USD',
    paymentMethod,
    paymentDetails,
    orderId,
    customerInfo
  } = paymentData;

  try {
    // Validate payment details
    const validation = validatePaymentDetails(paymentMethod, paymentDetails);
    if (!validation.isValid) {
      throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`);
    }

    // Simulate processing delay
    await delay(1000 + Math.random() * 2000); // 1-3 seconds

    // Simulate payment outcome
    const outcome = simulatePaymentOutcome(paymentDetails);

    const transactionId = generateTransactionId();
    const timestamp = new Date().toISOString();

    switch (outcome) {
      case 'success':
        return {
          status: 'success',
          transactionId,
          message: 'Payment processed successfully',
          gatewayResponse: {
            gateway: 'mock_gateway',
            timestamp,
            amount,
            currency,
            paymentMethod,
            authCode: crypto.randomBytes(8).toString('hex').toUpperCase(),
            last4: paymentDetails.cardNumber ? paymentDetails.cardNumber.slice(-4) : null
          }
        };

      case 'declined':
        return {
          status: 'failed',
          transactionId,
          message: 'Payment was declined by the bank',
          gatewayResponse: {
            gateway: 'mock_gateway',
            timestamp,
            errorCode: 'DECLINED',
            errorMessage: 'Transaction declined by issuing bank'
          }
        };

      case 'insufficient_funds':
        return {
          status: 'failed',
          transactionId,
          message: 'Insufficient funds',
          gatewayResponse: {
            gateway: 'mock_gateway',
            timestamp,
            errorCode: 'INSUFFICIENT_FUNDS',
            errorMessage: 'Insufficient funds in account'
          }
        };

      case 'expired_card':
        return {
          status: 'failed',
          transactionId,
          message: 'Card has expired',
          gatewayResponse: {
            gateway: 'mock_gateway',
            timestamp,
            errorCode: 'EXPIRED_CARD',
            errorMessage: 'Card has expired'
          }
        };

      case 'invalid_card':
        return {
          status: 'failed',
          transactionId,
          message: 'Invalid card details',
          gatewayResponse: {
            gateway: 'mock_gateway',
            timestamp,
            errorCode: 'INVALID_CARD',
            errorMessage: 'Invalid card number or details'
          }
        };

      default:
        throw new Error('Payment processing error');
    }

  } catch (error) {
    console.error('Payment processing error:', error);
    
    return {
      status: 'failed',
      transactionId: generateTransactionId(),
      message: error.message || 'Payment processing failed',
      gatewayResponse: {
        gateway: 'mock_gateway',
        timestamp: new Date().toISOString(),
        errorCode: 'PROCESSING_ERROR',
        errorMessage: error.message || 'Unknown error occurred'
      }
    };
  }
}

/**
 * Process refund
 * @param {object} refundData - Refund data
 * @returns {Promise<object>} Refund result
 */
async function refundPayment(refundData) {
  const {
    originalTransactionId,
    amount,
    reason = 'Refund requested'
  } = refundData;

  try {
    // Simulate processing delay
    await delay(500 + Math.random() * 1000); // 0.5-1.5 seconds

    // Simulate refund success (95% success rate)
    const isSuccess = Math.random() > 0.05;

    const refundTransactionId = generateTransactionId();
    const timestamp = new Date().toISOString();

    if (isSuccess) {
      return {
        status: 'success',
        refundTransactionId,
        message: 'Refund processed successfully',
        gatewayResponse: {
          gateway: 'mock_gateway',
          timestamp,
          originalTransactionId,
          refundAmount: amount,
          reason,
          refundId: crypto.randomBytes(8).toString('hex').toUpperCase()
        }
      };
    } else {
      return {
        status: 'failed',
        refundTransactionId,
        message: 'Refund processing failed',
        gatewayResponse: {
          gateway: 'mock_gateway',
          timestamp,
          originalTransactionId,
          errorCode: 'REFUND_FAILED',
          errorMessage: 'Unable to process refund at this time'
        }
      };
    }

  } catch (error) {
    console.error('Refund processing error:', error);
    
    return {
      status: 'failed',
      refundTransactionId: generateTransactionId(),
      message: error.message || 'Refund processing failed',
      gatewayResponse: {
        gateway: 'mock_gateway',
        timestamp: new Date().toISOString(),
        originalTransactionId,
        errorCode: 'PROCESSING_ERROR',
        errorMessage: error.message || 'Unknown error occurred'
      }
    };
  }
}

/**
 * Verify payment status (for webhook simulation)
 * @param {string} transactionId - Transaction ID to verify
 * @returns {Promise<object>} Verification result
 */
async function verifyPayment(transactionId) {
  try {
    // Simulate API call delay
    await delay(200 + Math.random() * 300);

    // In a real implementation, this would call the payment gateway's API
    // to verify the transaction status
    
    return {
      transactionId,
      status: 'verified',
      timestamp: new Date().toISOString(),
      verified: true
    };

  } catch (error) {
    console.error('Payment verification error:', error);
    
    return {
      transactionId,
      status: 'verification_failed',
      timestamp: new Date().toISOString(),
      verified: false,
      error: error.message
    };
  }
}

/**
 * Get supported payment methods
 * @returns {Array} List of supported payment methods
 */
function getSupportedPaymentMethods() {
  return [
    {
      id: 'credit_card',
      name: 'Credit Card',
      description: 'Visa, MasterCard, American Express',
      enabled: true,
      processingFee: 0.029, // 2.9%
      fixedFee: 0.30 // $0.30
    },
    {
      id: 'debit_card',
      name: 'Debit Card',
      description: 'Bank debit card',
      enabled: true,
      processingFee: 0.025, // 2.5%
      fixedFee: 0.25 // $0.25
    },
    {
      id: 'paypal',
      name: 'PayPal',
      description: 'Pay with your PayPal account',
      enabled: true,
      processingFee: 0.034, // 3.4%
      fixedFee: 0.30 // $0.30
    },
    {
      id: 'bank_transfer',
      name: 'Bank Transfer',
      description: 'Direct bank transfer (ACH)',
      enabled: false, // Disabled for demo
      processingFee: 0.008, // 0.8%
      fixedFee: 0.25 // $0.25
    }
  ];
}

/**
 * Calculate processing fees
 * @param {number} amount - Payment amount
 * @param {string} paymentMethod - Payment method
 * @returns {object} Fee calculation
 */
function calculateProcessingFees(amount, paymentMethod) {
  const methods = getSupportedPaymentMethods();
  const method = methods.find(m => m.id === paymentMethod);

  if (!method) {
    throw new Error('Unsupported payment method');
  }

  const percentageFee = amount * method.processingFee;
  const totalFee = percentageFee + method.fixedFee;
  const netAmount = amount - totalFee;

  return {
    grossAmount: amount,
    processingFee: totalFee,
    percentageFee,
    fixedFee: method.fixedFee,
    netAmount,
    feePercentage: method.processingFee
  };
}

module.exports = {
  processPayment,
  refundPayment,
  verifyPayment,
  getSupportedPaymentMethods,
  calculateProcessingFees,
  validatePaymentDetails
};
