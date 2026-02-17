import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import imageRoutes from './routes/image.routes.js'; 
import { corsConfig, handlePreflight } from './middleware/corsConfig.js';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ==================== HELPER FUNCTIONS ====================

/**
 * Retry function with exponential backoff for API calls
 */
async function fetchWithRetry(url, maxRetries = 3, options = {}) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios({
        url,
        timeout: 5000,
        ...options
      });
      return response;
    } catch (error) {
      const isLastAttempt = i === maxRetries - 1;
      
      if (isLastAttempt) {
        console.error(`❌ All ${maxRetries} retry attempts failed for ${url}`);
        throw error;
      }
      
      // Check if it's a rate limit error (429)
      if (error.response?.status === 429) {
        // Rate limit - wait longer
        const waitTime = 2000 * Math.pow(2, i); // 2s, 4s, 8s
        console.log(`⏳ Rate limited (429). Retry attempt ${i + 1}/${maxRetries} after ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Other errors - wait standard time
        const waitTime = 1000 * Math.pow(2, i); // 1s, 2s, 4s
        console.log(`⏳ Connection failed. Retry attempt ${i + 1}/${maxRetries} after ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
}

/**
 * Build correct URL for Python service
 */
function buildPythonUrl(endpoint) {
  const baseUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_LOCAL_URL || 'http://127.0.0.1:7000';
  // Remove trailing slash if present
  const cleanBase = baseUrl.replace(/\/$/, '');
  // Remove leading slash from endpoint if present
  const cleanEndpoint = endpoint.replace(/^\//, '');
  
  return `${cleanBase}/${cleanEndpoint}`;
}

/**
 * Wrapper for Python service calls with retry logic
 */
async function callPythonService(endpoint, options = {}, maxRetries = 3) {
  const url = buildPythonUrl(endpoint);
  console.log(`🔗 Calling Python service: ${url}`);
  
  try {
    const response = await fetchWithRetry(url, maxRetries, options);
    return response;
  } catch (error) {
    console.error(`❌ Python service call failed for ${endpoint}:`, error.message);
    throw error;
  }
}

/**
 * Safely serve a file for download
 */
function serveFileSafe(filePath, res) {
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const filename = path.basename(filePath);
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      }
    });
  } catch (error) {
    console.error('File serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ==================== MIDDLEWARE ====================

app.use(corsConfig);
app.use(handlePreflight);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API ROUTES ====================

// API Routes
app.use('/api/image', imageRoutes);

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    message: 'Service is healthy',
    status: 'OK'
  });
});

// Python service health check with retry
app.get('/api/python-health', async (req, res) => {
  try {
    const response = await callPythonService('health', { timeout: 5000 });
    
    console.log('✅ Python service connected');
    res.json({ 
      python_service: response.data,
      node_service: 'OK',
      status: 'CONNECTED'
    });
  } catch (error) {
    console.error('❌ Python service connection failed after retries:', error.message);
    
    res.status(503).json({ 
      python_service: 'UNREACHABLE', 
      node_service: 'OK',
      error: error.message,
      attempted_url: buildPythonUrl('health'),
      suggestion: `Check if Python service is running on ${process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:7000'}`
    });
  }
});

// Get jobs from python service with retry
app.get('/api/jobs', async(req, res) => {
  try {
    const response = await callPythonService('jobs', { timeout: 5000 });
    
    console.log(`✅ Retrieved ${response.data?.length || 0} jobs`);
    res.json(response.data || []);
  } catch (error) {
    console.error('❌ Failed to fetch jobs after retries:', error.message);
    
    // Return empty array instead of error for frontend
    res.json([]);
  }
});

// MongoDB health check with retry
app.get('/api/mongo-health', async (req, res) => {
  try {
    const response = await callPythonService('test-mongo', { timeout: 5000 });
    
    res.json({
      mongo_service: response.data,
      node_service: 'OK'
    });
  } catch (error) {
    res.status(503).json({ 
      mongo_service: 'UNREACHABLE', 
      node_service: 'OK',
      error: error.message 
    });
  }
});

// Proxy download endpoint with retry
app.get('/api/proxy-download/:job_id', async (req, res) => {
    try {
        const jobId = req.params.job_id;
        
        console.log(`📥 Proxying download for job: ${jobId}`);
        
        const response = await callPythonService(`download/${jobId}`, {
            responseType: 'arraybuffer',
            timeout: 30000
        }, 2); // Only retry twice for downloads
        
        // Forward headers from Python service
        res.set({
            'Content-Type': response.headers['content-type'],
            'Content-Disposition': response.headers['content-disposition'] || 
                                  `attachment; filename="passport_${jobId}.jpg"`,
            'Content-Length': response.headers['content-length']
        });
        res.send(response.data);
        
    } catch (error) {
        console.error('Proxy download error after retries:', error.message);
        
        // Try to serve from local storage as fallback
        try {
            const filePath = path.join(__dirname, '..', 'uploads', 'jobs', req.params.job_id, 'final_sheet.jpg');
            if (fs.existsSync(filePath)) {
                console.log('✅ Serving from local fallback storage');
                res.download(filePath, `passport_${req.params.job_id}.jpg`);
                return;
            }
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError.message);
        }
        
        res.status(404).json({ error: 'File not found' });
    }
});

// Upload endpoint (deprecated)
app.post('/api/upload', async (req, res) => {
  res.json({ message: 'Please use /api/image/upload endpoint for file uploads' });
});

// Download job file by job_id (local storage)
app.get('/api/download/job/:job_id', (req, res) => {
  try {
    const jobId = req.params.job_id;
    const filePath = path.join(__dirname, '..', 'uploads', 'jobs', jobId, 'final_sheet.jpg');
    
    console.log(`📥 Local download request for job: ${jobId}`);
    console.log(`📁 File path: ${filePath}`);
    
    serveFileSafe(filePath, res);
  } catch (error) {
    console.error('Download endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download any file by relative path (safer alternative)
app.get('/api/download/file', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'No file path provided' });
    }
    
    // Security: prevent directory traversal attacks
    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(__dirname, '..', safePath);
    
    console.log(`📥 Download request: ${safePath}`);
    console.log(`📁 Full path: ${fullPath}`);
    
    serveFileSafe(fullPath, res);
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List available jobs for download
app.get('/api/download/jobs', (req, res) => {
  try {
    const jobsDir = path.join(__dirname, '..', 'uploads', 'jobs');
    
    if (!fs.existsSync(jobsDir)) {
      return res.json([]);
    }
    
    const jobFolders = fs.readdirSync(jobsDir)
      .filter(folder => {
        const jobPath = path.join(jobsDir, folder);
        const finalSheet = path.join(jobPath, 'final_sheet.jpg');
        return fs.existsSync(finalSheet);
      })
      .map(folder => {
        const jobPath = path.join(jobsDir, folder);
        const metaPath = path.join(jobPath, 'meta.json');
        let meta = {};
        
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch (e) {
            console.error(`Error reading meta.json for ${folder}:`, e);
          }
        }
        
        return {
          job_id: folder,
          final_sheet: `/api/download/job/${folder}`,
          created_at: meta.created_at || fs.statSync(jobPath).mtime.toISOString(),
          preset: meta.preset || 'unknown',
          copies: meta.copies || 0
        };
      });
    
    res.json(jobFolders);
  } catch (error) {
    console.error('Jobs list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FRONTEND ROUTES ====================

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route for SPA (excluding API routes)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SERVER START ====================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n🚀 ==================================');
  console.log(`✅ Node.js server running on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🐍 Python service: ${process.env.PYTHON_SERVICE_URL || 'http://localhost:7000'}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'public')}`);
  console.log('=====================================\n');
});