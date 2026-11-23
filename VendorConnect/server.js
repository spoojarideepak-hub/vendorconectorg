
const express = require('express');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const app = express();
const PORT = process.env.PORT || 3000;
const {
    authenticateToken,
    authorizeRole
} = require('./middleware/authMiddleware');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Authentication routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
// Buyer protected route
app.get(
    '/api/buyer/dashboard',
    authenticateToken,
    authorizeRole('buyer'),
    (req, res) => {
        res.json({
            success: true,
            message: 'Welcome to Buyer Dashboard',
            user: req.user
        });
    }
);

// Seller protected route
app.get(
    '/api/seller/dashboard',
    authenticateToken,
    authorizeRole('supplier'),
    (req, res) => {
        res.json({
            success: true,
            message: 'Welcome to Seller Dashboard',
            user: req.user
        });
    }
);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Test backend
app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');

        res.json({
            success: true,
            message: 'VendorConnect backend and database connected!'
        });

    } catch (error) {
        console.error(error.message);

        res.status(500).json({
            success: false,
            message: 'Database connection failed'
        });
    }
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`VendorConnect running on port ${PORT}`);
    });
}

module.exports = app;
