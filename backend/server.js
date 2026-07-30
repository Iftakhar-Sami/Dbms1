const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Parses incoming JSON payloads

// Mount Routes
const eventRoutes = require('./routes/eventRoutes');
app.use('/api/events', eventRoutes);

const teamRoutes = require('./routes/teamRoutes');
app.use('/api/teams', teamRoutes);

const matchRoutes = require('./routes/matchRoutes');
app.use('/api/matches', matchRoutes);

const managerRoutes = require('./routes/managerRoutes');
app.use('/api/managers', managerRoutes);


const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');

app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);

// Add this with your other routes in server.js
const seasonRoutes = require('./routes/seasonRoutes');
app.use('/api/seasons', seasonRoutes);

// Start Server
const PORT = process.env.PORT ||3000 ;
app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
