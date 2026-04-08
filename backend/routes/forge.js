// routes/forge.js - TEMPORARILY DISABLED
// import express from 'express';
// import multer from 'multer';
// import { supabase } from '../lib/supabase.js';
// import { ForgeController } from '../controllers/ForgeController.js';
// import { validateFile } from '../middleware/validateFile.js';

// const router = express.Router();
// const upload = multer({ storage: multer.memoryStorage() });

// // ============================================
// // AUTH MIDDLEWARE (inline)
// // ============================================
// async function requireAuth(req, res, next) {
//   const token = req.headers.authorization?.replace('Bearer ', '');
//   if (!token) return res.status(401).json({ error: 'Unauthorized' });

//   const { data: { user }, error } = await supabase.auth.getUser(token);
//   if (error || !user) return res.status(401).json({ error: 'Invalid token' });

//   req.user = user;
//   next();
// }

// // ============================================
// // ROUTES
// // ============================================
// router.use(requireAuth);

// router.post('/upload', upload.single('file'), validateFile, ForgeController.uploadAsset);
// router.get('/asset/:id', ForgeController.getAsset);
// router.put('/asset/:id', ForgeController.updateAsset);
// router.delete('/asset/:id', ForgeController.deleteAsset);
// router.post('/asset/:id/publish', ForgeController.publishAsset);
// router.get('/my-assets', ForgeController.getUserAssets);
// router.get('/marketplace', ForgeController.getMarketplace);
// router.post('/asset/:id/collaborators', ForgeController.addCollaborator);
// router.delete('/asset/:id/collaborators/:userId', ForgeController.removeCollaborator);

// export default router;

// File disabled - Forge features not needed for MVP 
