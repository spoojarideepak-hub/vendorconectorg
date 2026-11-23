
const express = require('express');
const router = express.Router();

const db = require('../config/database');
const { authenticateToken, authorizeRole } =
    require('../middleware/authMiddleware');
    const upload = require('../middleware/upload');
    
    // Get all product categories
router.get('/categories', async (req, res) => {
    try {
        const [categories] = await db.query(
            'SELECT id, category_name FROM categories ORDER BY category_name'
        );

        res.json({
            success: true,
            categories
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Unable to fetch categories'
        });
    }
});

    

// Get all products belonging to the logged-in seller
router.get('/my-products',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const [products] = await db.query(
                'SELECT * FROM products WHERE supplier_id = ? ORDER BY created_at DESC',
                [req.user.id]
            );

            res.json({ success: true, products });

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Unable to fetch products' });
        }
    }
);



// Add a new product with optional image upload
router.post(
    '/',
    authenticateToken,
    authorizeRole('supplier'),
    upload.single('product_image'),
    async (req, res) => {
        try {
            const {
                category_id,
                product_name,
                description,
                price,
                stock_quantity
            } = req.body || {};

            if (
                !product_name?.trim() ||
                !Number.isInteger(Number(category_id)) ||
                Number(category_id) <= 0 ||
                !Number.isFinite(Number(price)) ||
                Number(price) <= 0 ||
                !Number.isInteger(Number(stock_quantity)) ||
                Number(stock_quantity) < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter valid product details'
                });
            }

            const imageUrl = req.file
                ? `/uploads/${req.file.filename}`
                : null;

            const [result] = await db.query(
                `INSERT INTO products
                (
                    supplier_id,
                    category_id,
                    product_name,
                    description,
                    price,
                    stock_quantity,
                    image_url
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    Number(category_id),
                    product_name.trim(),
                    description || '',
                    Number(price),
                    Number(stock_quantity),
                    imageUrl
                ]
            );

            res.status(201).json({
                success: true,
                message: 'Product added successfully',
                productId: result.insertId,
                image_url: imageUrl
            });

        } catch (error) {
            console.error('Add product error:', error);

            res.status(500).json({
                success: false,
                message: 'Unable to add product'
            });
        }
    }
);

// Get all products for the buyer marketplace
router.get('/all', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT
                products.id,
                products.product_name,
                products.description,
                products.price,
                products.stock_quantity,
                products.image_url,
                categories.category_name,
                users.business_name
            FROM products
            JOIN categories
                ON products.category_id = categories.id
            JOIN users
                ON products.supplier_id = users.id
            WHERE products.stock_quantity > 0
            ORDER BY products.created_at DESC
        `);

        res.json({
            success: true,
            products
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Unable to fetch marketplace products'
        });
    }
});
// Submit a quotation request (Buyer only)
router.post(
    '/request-quotation',
    authenticateToken,
    authorizeRole('buyer'),
    async (req, res) => {
        try {
            const { product_id, quantity, message } = req.body;
            const buyer_id = req.user.id;

            if (!product_id || !quantity || quantity <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a valid product and quantity'
                });
            }

            const [products] = await db.query(
                'SELECT id FROM products WHERE id = ?',
                [product_id]
            );

            if (products.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            await db.query(
                `INSERT INTO quotations
                (buyer_id, product_id, quantity, message, status)
                VALUES (?, ?, ?, ?, 'pending')`,
                [buyer_id, product_id, quantity, message || '']
            );

            res.status(201).json({
                success: true,
                message: 'Quotation request submitted successfully'
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to submit quotation request'
            });
        }
    }
);
// Get quotation requests received by the logged-in seller
router.get(
    '/seller/quotations',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const [requests] = await db.query(
                `SELECT
                    quotations.id,
                    quotations.product_id,
                    quotations.quantity,
                    quotations.message,
                    quotations.status,
                    quotations.created_at,
                    products.product_name,
                    users.name AS buyer_name,
                    users.email AS buyer_email
                FROM quotations
                JOIN products
                    ON quotations.product_id = products.id
                JOIN users
                    ON quotations.buyer_id = users.id
                WHERE products.supplier_id = ?
                ORDER BY quotations.created_at DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                requests
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to fetch quotation requests'
            });
        }
    }
);

// Accept or reject a quotation request

router.patch(
    '/seller/quotations/:id',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        let connection;

        try {
            const { status } = req.body;
            const quotationId = req.params.id;

            if (!['accepted', 'rejected'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid quotation status'
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            // Find the quotation and lock its product row
            const [quotations] = await connection.query(
                `SELECT
                    quotations.id,
                    quotations.quantity,
                    quotations.status,
                    products.stock_quantity
                 FROM quotations
                 JOIN products
                    ON quotations.product_id = products.id
                 WHERE quotations.id = ?
                   AND products.supplier_id = ?
                 FOR UPDATE`,
                [quotationId, req.user.id]
            );

            if (quotations.length === 0) {
                await connection.rollback();

                return res.status(404).json({
                    success: false,
                    message: 'Quotation not found'
                });
            }

            const quotation = quotations[0];

            if (quotation.status !== 'pending') {
                await connection.rollback();

                return res.status(400).json({
                    success: false,
                    message: 'Quotation has already been processed'
                });
            }

            // Check stock before accepting
            if (
                status === 'accepted' &&
                quotation.quantity > quotation.stock_quantity
            ) {
                await connection.rollback();

                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock. Only ${quotation.stock_quantity} units are available.`
                });
            }

            // Update quotation status
            await connection.query(
                `UPDATE quotations
                 SET status = ?
                 WHERE id = ?`,
                [status, quotationId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: `Quotation ${status} successfully`
            });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }

            console.error(error);

            res.status(500).json({
                success: false,
                message: 'Unable to update quotation'
            });

        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
);


// Get quotation requests made by the logged-in buyer
router.get(
    '/buyer/quotations',
    authenticateToken,
    authorizeRole('buyer'),
    async (req, res) => {
        try {
            const [requests] = await db.query(
                `SELECT
                    quotations.id,
                    quotations.quantity,
                    quotations.message,
                    quotations.status,
                    quotations.created_at,
                    products.product_name,
                    users.name AS seller_name,
                    users.business_name AS seller_business
                 FROM quotations
                 JOIN products
                    ON quotations.product_id = products.id
                 JOIN users
                    ON products.supplier_id = users.id
                 WHERE quotations.buyer_id = ?
                 ORDER BY quotations.created_at DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                requests
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to fetch your quotation history'
            });
        }
    }
);
// Get orders placed by the logged-in buyer
router.get(
    '/buyer/orders',
    authenticateToken,
    authorizeRole('buyer'),
    async (req, res) => {
        try {
            const [orders] = await db.query(
                `SELECT
                    orders.id,
                    orders.quantity,
                    orders.total_amount,
                    orders.status,
                    orders.created_at,
                    products.product_name,
                    users.name AS seller_name,
                    users.business_name AS seller_business
                 FROM orders
                 JOIN products
                    ON orders.product_id = products.id
                 JOIN users
                    ON products.supplier_id = users.id
                 WHERE orders.buyer_id = ?
                 ORDER BY orders.created_at DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                orders
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to fetch your orders'
            });
        }
    }
);







// Get orders received by the logged-in seller
router.get(
    '/seller/orders',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const [orders] = await db.query(
                `SELECT
                    orders.id,
                    orders.quantity,
                    orders.total_amount,
                    orders.status,
                    orders.created_at,
                    products.product_name,
                    users.name AS buyer_name,
                    users.email AS buyer_email
                 FROM orders
                 JOIN products
                    ON orders.product_id = products.id
                 JOIN users
                    ON orders.buyer_id = users.id
                 WHERE products.supplier_id = ?
                 ORDER BY orders.created_at DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                orders
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to fetch seller orders'
            });
        }
    }
);

// Update order status by seller and restore stock on cancellation
router.patch(
    '/seller/orders/:id',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        let connection;
        let transactionStarted = false;

        try {
            const { status } = req.body;
            const orderId = Number(req.params.id);

            const allowedStatuses = [
                'confirmed',
                'shipped',
                'delivered',
                'cancelled'
            ];

            if (!Number.isInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order ID'
                });
            }

            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order status'
                });
            }

            connection = await db.getConnection();

            await connection.beginTransaction();
            transactionStarted = true;

            // Lock the order and its product row
            const [orders] = await connection.query(
                `SELECT
                    orders.id,
                    orders.status,
                    orders.product_id,
                    orders.quantity
                 FROM orders
                 JOIN products
                    ON orders.product_id = products.id
                 WHERE orders.id = ?
                 AND products.supplier_id = ?
                 FOR UPDATE`,
                [orderId, req.user.id]
            );

            if (orders.length === 0) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const order = orders[0];

            const validTransitions = {
                pending: ['confirmed', 'cancelled'],
                confirmed: ['shipped', 'cancelled'],
                shipped: ['delivered'],
                delivered: [],
                cancelled: []
            };

            if (!validTransitions[order.status]?.includes(status)) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message: 'Invalid status transition'
                });
            }

            // Restore product stock only when cancelling
            if (status === 'cancelled') {
                await connection.query(
                    `UPDATE products
                     SET stock_quantity = stock_quantity + ?
                     WHERE id = ?`,
                    [order.quantity, order.product_id]
                );
            }

            // Update order status
            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ?',
                [status, orderId]
            );

            await connection.commit();
            transactionStarted = false;

            res.json({
                success: true,
                message: status === 'cancelled'
                    ? 'Order cancelled and stock restored successfully'
                    : 'Order status updated successfully'
            });

        } catch (error) {
            if (connection && transactionStarted) {
                await connection.rollback();
            }

            console.error(error);

            res.status(500).json({
                success: false,
                message: 'Unable to update order status'
            });

        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
);


// Update a product belonging to the logged-in seller

router.patch(
    '/my-products/:id',
    authenticateToken,
    authorizeRole('supplier'),
    upload.single('product_image'),
    async (req, res) => {
        try {
            const productId = Number(req.params.id);

            const {
                product_name,
                description,
                price,
                stock_quantity
            } = req.body;

            if (!Number.isInteger(productId) || productId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            if (
                !product_name?.trim() ||
                !Number.isFinite(Number(price)) ||
                Number(price) <= 0 ||
                !Number.isInteger(Number(stock_quantity)) ||
                Number(stock_quantity) < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter valid product details'
                });
            }

            // Verify product ownership and get existing image
            const [products] = await db.query(
                `SELECT id, image_url FROM products
                 WHERE id = ? AND supplier_id = ?`,
                [productId, req.user.id]
            );

            if (products.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            // Keep existing image unless a new one is uploaded
            const imageUrl = req.file
                ? `/uploads/${req.file.filename}`
                : products[0].image_url;

            // Update product details and image
            await db.query(
                `UPDATE products
                 SET product_name = ?,
                     description = ?,
                     price = ?,
                     stock_quantity = ?,
                     image_url = ?
                 WHERE id = ?
                 AND supplier_id = ?`,
                [
                    product_name.trim(),
                    description || '',
                    Number(price),
                    Number(stock_quantity),
                    imageUrl,
                    productId,
                    req.user.id
                ]
            );

            res.json({
                success: true,
                message: 'Product updated successfully'
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message: 'Unable to update product'
            });
        }
    }
);

// Get orders received by the logged-in supplier
router.get(
    '/seller/orders',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const [orders] = await db.query(
                `SELECT
                    orders.id,
                    orders.quantity,
                    orders.total_amount,
                    orders.status,
                    orders.created_at,
                    products.product_name,
                    users.name AS buyer_name,
                    users.email AS buyer_email
                 FROM orders
                 JOIN products
                    ON orders.product_id = products.id
                 JOIN users
                    ON orders.buyer_id = users.id
                 WHERE products.supplier_id = ?
                 ORDER BY orders.created_at DESC`,
                [req.user.id]
            );

            res.json({
                success: true,
                orders
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Unable to fetch seller orders'
            });
        }
    }
);


 // Update the status of an order received by the supplier
router.patch(
    '/seller/orders/:id',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const newStatus = req.body.status;

            if (!Number.isInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order ID'
                });
            }

            const [orders] = await db.query(
                `SELECT orders.id, orders.status
                 FROM orders
                 JOIN products
                    ON orders.product_id = products.id
                 WHERE orders.id = ?
                 AND products.supplier_id = ?`,
                [orderId, req.user.id]
            );

            if (orders.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const currentStatus = orders[0].status;

            const allowedTransitions = {
                pending: ['confirmed'],
                confirmed: ['shipped'],
                shipped: ['delivered'],
                delivered: []
            };

            if (
                !allowedTransitions[currentStatus] ||
                !allowedTransitions[currentStatus].includes(newStatus)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order status transition'
                });
            }

            await db.query(
                `UPDATE orders
                 SET status = ?
                 WHERE id = ?`,
                [newStatus, orderId]
            );

            res.json({
                success: true,
                message: 'Order status updated successfully',
                status: newStatus
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message: 'Unable to update order status'
            });
        }
    }
);

// Delete a product belonging to the logged-in supplier
router.delete(
    '/my-products/:id',
    authenticateToken,
    authorizeRole('supplier'),
    async (req, res) => {
        try {
            const productId = Number(req.params.id);

            if (!Number.isInteger(productId) || productId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid product ID'
                });
            }

            // Verify that the product belongs to this supplier
            const [products] = await db.query(
                `SELECT id FROM products
                 WHERE id = ? AND supplier_id = ?`,
                [productId, req.user.id]
            );

            if (products.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            // Prevent deletion if the product has quotation history
            const [quotations] = await db.query(
                'SELECT COUNT(*) AS total FROM quotations WHERE product_id = ?',
                [productId]
            );

            // Prevent deletion if the product has order history
            const [orders] = await db.query(
                'SELECT COUNT(*) AS total FROM orders WHERE product_id = ?',
                [productId]
            );

            if (quotations[0].total > 0 || orders[0].total > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'This product cannot be deleted because it has quotation or order history.'
                });
            }

            await db.query(
                `DELETE FROM products
                 WHERE id = ? AND supplier_id = ?`,
                [productId, req.user.id]
            );

            res.json({
                success: true,
                message: 'Product deleted successfully'
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message: 'Unable to delete product'
            });
        }
    }
);

// Place an order from an accepted quotation (Buyer only)
router.post(
    '/buyer/orders/from-quotation/:quotationId',
    authenticateToken,
    authorizeRole('buyer'),
    async (req, res) => {
        let connection;

        try {
            const quotationId = Number(req.params.quotationId);
            const buyerId = req.user.id;

            if (!Number.isInteger(quotationId) || quotationId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid quotation ID'
                });
            }

            connection = await db.getConnection();
            await connection.beginTransaction();

            // Find and lock the accepted quotation and its product
            const [quotations] = await connection.query(
                `SELECT
                    q.id,
                    q.product_id,
                    q.quantity,
                    q.status,
                    p.price,
                    p.stock_quantity
                 FROM quotations q
                 JOIN products p ON q.product_id = p.id
                 WHERE q.id = ?
                 AND q.buyer_id = ?
                 FOR UPDATE`,
                [quotationId, buyerId]
            );

            if (quotations.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Quotation not found'
                });
            }

            const quotation = quotations[0];

            if (quotation.status !== 'accepted') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'This quotation has not been accepted'
                });
            }

            // Prevent duplicate orders
            const [existingOrders] = await connection.query(
                'SELECT id FROM orders WHERE quotation_id = ?',
                [quotationId]
            );

            if (existingOrders.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: 'An order already exists for this quotation'
                });
            }

            // Check available stock
            if (quotation.quantity > quotation.stock_quantity) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient stock available'
                });
            }

            const totalAmount =
                Number(quotation.price) * Number(quotation.quantity);

            // Create the order
            const [result] = await connection.query(
                `INSERT INTO orders
                    (buyer_id, product_id, quotation_id,
                     quantity, total_amount, status)
                 VALUES (?, ?, ?, ?, ?, 'pending')`,
                [
                    buyerId,
                    quotation.product_id,
                    quotationId,
                    quotation.quantity,
                    totalAmount
                ]
            );

            // Reduce available stock
            await connection.query(
                `UPDATE products
                 SET stock_quantity = stock_quantity - ?
                 WHERE id = ?`,
                [quotation.quantity, quotation.product_id]
            );

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Order placed successfully',
                orderId: result.insertId,
                totalAmount
            });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }

            console.error('Place order error:', error);

            res.status(500).json({
                success: false,
                message: 'Unable to place order'
            });

        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
);


module.exports = router;
