import express from 'express';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import rentalRoutes from './routes/rentals.js';
import { requireUser } from './middleware/auth.mjs';
import { User } from './model/user.mjs';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json({ limit: '22mb' }));
app.use('/uploads', express.static(fileURLToPath(new URL('../uploads', import.meta.url))));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', rentalRoutes);

app.get('/api/auth/me', requireUser, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password -identityFrontPath -identityBackPath').lean()
  res.json({ user })
});

app.get('/', (req, res) => {
  res.send('RentEase API is running');
});

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API endpoint not found.' })
})

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error)
  const status = error.status === 413 ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
  const message = status === 413
    ? 'The upload is too large. Reduce photo sizes and try again.'
    : status === 400
      ? 'The request body contains invalid JSON.'
      : 'The server could not complete this request.'
  res.status(status).json({ message })
});


export default app;
