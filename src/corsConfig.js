// api/corsConfig.js
import "dotenv/config";

export const corsConfig = {
  origin: function(origin, callback) {
    // Permitir requests sin origin (aplicaciones móviles, Postman, etc.)
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // En desarrollo, permitir cualquier origen
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (origin == process.env.FRONTEND_URL) {
      callback(null, true);
    } else {
      console.log(`CORS Error: Origin ${origin} not allowed.`);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['set-cookie'], // Permite que el navegador acceda al header set-cookie
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'], // Métodos permitidos
  optionsSuccessStatus: 200 // Para navegadores legacy
};