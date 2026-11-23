
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const router = express.Router();

// Common registration function
async function register(req, res, role) {
    try {
        const { name, email, password, phone, business_name } = req.body;

        // Validate required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                message: 'Name, email and password are required'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: 'Password must contain at least 8 characters'
            });
        }

        // Check existing email
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email.trim()]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: 'Email already registered'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert user
        const [result] = await db.execute(
            `INSERT INTO users
            (name, email, password, role, phone, business_name)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                name.trim(),
                email.trim(),
                hashedPassword,
                role,
                phone || null,
                role === 'supplier' ? business_name || null : null
            ]
        );

        res.status(201).json({
            message: 'Registration successful',
            userId: result.insertId,
            role: role
        });

    } catch (error) {
        console.error('Registration error:', error);

        res.status(500).json({
            message: 'Server error during registration'
        });
    }
}

// Buyer registration
router.post('/register/buyer', (req, res) => {
    register(req, res, 'buyer');
});

// Seller registration
router.post('/register/seller', (req, res) => {
    register(req, res, 'supplier');
});

// Login for buyers and sellers
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        // Find user
        const [users] = await db.execute(
            `SELECT id, name, email, password, role, business_name
             FROM users WHERE email = ?`,
            [email.trim()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        const user = users[0];

        // Verify password
        const isMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!isMatch) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

    
       // Generate JWT token
const token = jwt.sign(
    {
        id: user.id,
        role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
);

// Successful login
res.status(200).json({
    message: 'Login successful',
    token: token,
    user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        business_name: user.business_name
    }
});
    } catch (error) {
        console.error('Login error:', error);

        res.status(500).json({
            message: 'Server error during login'
        });
    }
});


module.exports = router;
