// config/security.js

export const securityConfig = {
  // CORS Configuration
  cors: {
    allowedOrigins: process.env.NODE_ENV === 'production'
      ? ['https://buildx.com', 'https://www.buildx.com', 'https://app.buildx.com']
      : ['http://localhost:3000', 'http://localhost:8081'],
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400, // 24 hours
  },

  // Rate Limiting
  rateLimits: {
    bids: { windowMs: 10000, max: 3, message: 'Too many bids. Please wait 10 seconds.' },
    login: { windowMs: 60000, max: 5, message: 'Too many login attempts. Try again in 1 minute.' },
    signup: { windowMs: 3600000, max: 3, message: 'Too many accounts created. Try again later.' },
    upload: { windowMs: 3600000, max: 5, message: 'Too many uploads. Try again in 1 hour.' },
    message: { windowMs: 30000, max: 10, message: 'Too many messages. Slow down.' },
    api: { windowMs: 60000, max: 100, message: 'Too many requests. Slow down.' },
  },

  // File Upload
  upload: {
    maxFileSize: 500 * 1024 * 1024, // 500MB
    allowedMimeTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/flac',
      'application/pdf',
      'model/gltf+json', 'model/gltf-binary',
      'application/zip', 'application/x-zip-compressed',
    ],
    virusScan: true,
    generatePreview: true,
    addWatermark: true,
  },

  // Session
  session: {
    expiryDays: 7,
    refreshExpiryDays: 30,
    extendOnActivity: true,
  },

  // Password Policy
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: false,
    preventCommonPasswords: true,
    preventEmailAsPassword: true,
  },

  // JWT
  jwt: {
    expiresIn: '7d',
    refreshExpiresIn: '30d',
    algorithm: 'HS256',
  },

  // Encryption
  encryption: {
    algorithm: 'aes-256-gcm',
    keyRotationDays: 90,
  },

  // Headers (Helmet)
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://*.supabase.co', 'https://*.onrender.com'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
  },

  // WebSocket
  websocket: {
    pingInterval: 30000,
    pongTimeout: 10000,
    maxConnectionsPerRoom: 100,
  },

  // Backup
  backup: {
    enabled: true,
    interval: '0 2 * * *', // Daily at 2 AM
    retentionDays: 30,
  },

  // Audit
  audit: {
    logAllActions: true,
    logSensitiveData: false,
    retentionDays: 90,
  },
};

// Helper to get config value
export function getConfig(path) {
  return path.split('.').reduce((obj, key) => obj?.[key], securityConfig);
}

// Helper to check if feature is enabled
export function isEnabled(feature) {
  const features = {
    virusScan: securityConfig.upload.virusScan,
    previewGeneration: securityConfig.upload.generatePreview,
    watermark: securityConfig.upload.addWatermark,
    auditLogs: securityConfig.audit.logAllActions,
  };
  return features[feature] || false;
}
