import cors from 'cors';


const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173', 
  'http://localhost:5174',
  'http://localhost:3001',
  'https://aakashsahu.vercel.app',
   process.env.FRONTEND_URL, // Allow all Vercel subdomains
   "https://ephotograpfy-frontend.vercel.app",
   "https://ephotografypythonbackend-2.onrender.com"
   

 
].filter(Boolean);

// Main CORS configuration for API routes
export const corsConfig = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } 
    // Check for Vercel subdomains
    else if (origin.endsWith('.vercel.app')) {
      callback(null, true);
    }
    else {
      console.log('CORS blocked for origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With','x-device-id'],
  exposedHeaders: ['Content-Length', 'Content-Type'] // Expose these headers
});

// CORS for static files (more permissive)
export const staticCorsConfig = (req, res, next) => {
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin) || !origin || origin.endsWith('.vercel.app')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  }
  
  next();
};

export const handlePreflight = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin) || !origin || origin.endsWith('.vercel.app')) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With','x-device-id');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours
    }
    return res.sendStatus(200);
  }
  next();
};