const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
require('./server');

setTimeout(() => {
    exec(`start "" "http://localhost:${PORT}"`);
}, 900);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
