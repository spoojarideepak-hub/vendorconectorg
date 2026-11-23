
const db = require('./config/database');

async function testConnection() {
    try {
        const connection = await db.getConnection();

        console.log('MySQL connected successfully!');

        const [rows] = await connection.query(
            'SELECT DATABASE() AS database_name'
        );

        console.log('Database:', rows[0].database_name);

        connection.release();
        await db.end();
        process.exit(0);

    } catch (error) {
        console.error('Database connection failed:', error.message);
        process.exit(1);
    }
}

testConnection();
