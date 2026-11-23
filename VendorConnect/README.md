# VendorConnect

## Run locally
1. Install Node.js (LTS).
2. Run `npm install`.
3. Create a `.env` file in the project root with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, and your authentication secret variables.
4. Run `npm start`.
5. Open http://localhost:3000.

Do not commit `.env`, `node_modules`, or database credentials. Product uploads are currently stored in `public/uploads`; configure persistent cloud/object storage before production deployment.
