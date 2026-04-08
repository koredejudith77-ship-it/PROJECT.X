// routes/forge.js
import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { validateFile } from '../middleware/validateFile.js';
import { ForgeController } from '../controllers/ForgeController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All routes require authentication
router.use(requireAuth);

// Asset CRUD
router.post('/upload', upload.single('file'), validateFile, ForgeController.uploadAsset);
router.get('/asset/:id', ForgeController.getAsset);
router.put('/asset/:id', ForgeController.updateAsset);
router.delete('/asset/:id', ForgeController.deleteAsset);
router.post('/asset/:id/publish', ForgeController.publishAsset);

// User assets
router.get('/my-assets', ForgeController.getUserAssets);

// Marketplace
router.get('/marketplace', ForgeController.getMarketplace);

// Collaborators
router.post('/asset/:id/collaborators', ForgeController.addCollaborator);
router.delete('/asset/:id/collaborators/:userId', ForgeController.removeCollaborator);

export default router;
