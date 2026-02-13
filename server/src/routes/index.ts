import { Router } from 'express';
import authRoutes from './authRoutes';
import itemRoutes from './itemRoutes';
import rentalRoutes from './rentalRoutes';
import paymentRoutes from './paymentRoutes';
import kioskRoutes from './kioskRoutes';
import notificationRoutes from './notificationRoutes';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'EngiRent API is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/items', itemRoutes);
router.use('/rentals', rentalRoutes);
router.use('/payments', paymentRoutes);
router.use('/kiosk', kioskRoutes);
router.use('/notifications', notificationRoutes);

export default router;
