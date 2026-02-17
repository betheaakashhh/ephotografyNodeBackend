import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import imageRoutes from './routes/image.routes.js'; 
import { corsConfig, handlePreflight } from './middleware/corsConfig.js';
import { fileURLToPath } from 'url';
import axios from 'axios';


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(corsConfig);
app.use(handlePreflight);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/image', imageRoutes);

// Health endpoint - MUST come before wildcard route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    message: 'Service is healthy',
    status: 'OK'
  });
});

// Helper function to build correct URLs
function buildPythonUrl(endpoint) {
  const baseUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_LOCAL_URL || 'http://127.0.0.1:7000';
  // Remove trailing slash if present
  const cleanBase = baseUrl.replace(/\/$/, '');
  // Remove leading slash from endpoint if present
  const cleanEndpoint = endpoint.replace(/^\//, '');
  
  return `${cleanBase}/${cleanEndpoint}`;
}

// Python service health check
app.get('/api/python-health', async (req, res) => {
  try {
    const url = buildPythonUrl('health');
    console.log(`🔗 Connecting to: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 5000
    });
    
    console.log('✅ Python service connected');
    res.json({ 
      python_service: response.data,
      node_service: 'OK',
      status: 'CONNECTED'
    });
  } catch (error) {
    console.error('❌ Python service connection failed:', error.message);
    console.error('Attempted URL:', error.config?.url);
    
    res.status(503).json({ 
      python_service: 'UNREACHABLE', 
      node_service: 'OK',
      error: error.message,
      attempted_url: error.config?.url,
      suggestion: 'Check if Python service is running on port 7000'
    });
  }
});

// Get jobs from python service
app.get('/api/jobs', async(req, res) => {
  try {
    const url = buildPythonUrl('jobs');
    console.log(`📋 Fetching jobs from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 5000
    });
    
    console.log(`✅ Retrieved ${response.data?.length || 0} jobs`);
    res.json(response.data || []);
  } catch (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    console.error('Attempted URL:', error.config?.url);
    
    // Return empty array instead of error for frontend
    res.json([]);
  }
});

// For the remove-bg endpoint in image.routes.js, use:
function buildRemoveBgUrl() {
  const baseUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_LOCAL_URL || 'http://127.0.0.1:7000';
  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}/remove-bg/`;
}

// Python service health check
// Update the error handling in your API endpoints:

// Python service health check
/* app.get('/api/python-health', async (req, res) => {
  try {
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:7000';
    console.log(`🔗 Attempting to connect to Python service: ${pythonServiceUrl}/health`);
    
    const response = await axios.get(`${pythonServiceUrl}/health`, {
      timeout: 5000
    });
    
    console.log('✅ Python service response:', response.data);
    res.json({ 
      python_service: response.data,
      node_service: 'OK'
    });
  } catch (error) {
    console.error('❌ Python service connection failed:', error.message);
    console.error('Full error:', error);
    
    res.status(503).json({ 
      python_service: 'UNREACHABLE', 
      node_service: 'OK',
      error: error.message,
      python_url: process.env.PYTHON_SERVICE_URL || 'http://localhost:7000'
    });
  }
});

// Get jobs from python service
app.get('/api/jobs', async(req, res) => {
  try {
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:7000';
    console.log(`📋 Fetching jobs from: ${pythonServiceUrl}/jobs`);
    
    const response = await axios.get(`${pythonServiceUrl}/jobs`, {
      timeout: 5000
    });
    
    console.log(`✅ Retrieved ${response.data?.length || 0} jobs`);
    res.json(response.data);
  } catch (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    console.error('Error code:', error.code);
    console.error('Error response:', error.response?.data);
    
    res.status(503).json({
      error: 'Unable to fetch jobs from Python service',
      details: error.message,
      code: error.code,
      python_url: process.env.PYTHON_SERVICE_URL || 'http://localhost:7000'
    });
  }
}); */

// Add this proxy endpoint to app.js
app.get('/api/proxy-download/:job_id', async (req, res) => {
    try {
        const jobId = req.params.job_id;
        const pythonUrl = `${process.env.PYTHON_SERVICE_URL ||process.env.PYTHON_LOCAL_URL ||'http://127.0.0.1:7000'}/download/${jobId}`;
        
        console.log(`📥 Proxying download for job: ${jobId}`);
        
        const response = await axios.get(pythonUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });
        
        // Forward headers from Python service
        res.set({
            'Content-Type': response.headers['content-type'],
            'Content-Disposition': response.headers['content-disposition'] || 
                                  `attachment; filename="passport_${jobId}.jpg"`,
            'Content-Length': response.headers['content-length']
        });
        res.send(response.data);
        
        // Stream the file from Python to client
        response.data.pipe(res);
        
    } catch (error) {
        console.error('Proxy download error:', error.message);
        
        // Try to serve from local storage as fallback
        try {
            const filePath = path.join(__dirname, '..', 'uploads', 'jobs', req.params.job_id, 'final_sheet.jpg');
            if (fs.existsSync(filePath)) {
                res.download(filePath, `passport_${req.params.job_id}.jpg`);
                return;
            }
        } catch (fallbackError) {
            // Ignore fallback error
        }
        
        res.status(404).json({ error: 'File not found' });
    }
});

// MongoDB health check
app.get('/api/mongo-health', async (req, res) => {
  try {
    const pythonUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_LOCAL_URL || 'http://127.0.0.1:7000';
    const response = await axios.get(`${pythonUrl}/test-mongo`);
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

// Get jobs from python service


// Upload endpoint (deprecated - use /api/image/upload instead)
app.post('/api/upload', async (req, res) => {
  res.json({ message: 'Please use /api/image/upload endpoint for file uploads' });
});

import fs from 'fs';
import path from 'path';

// Helper

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

// Download job file by job_id
app.get('/api/download/job/:job_id', (req, res) => {
  try {
    const jobId = req.params.job_id;
    const filePath = path.join(__dirname, '..', 'uploads', 'jobs', jobId, 'final_sheet.jpg');
    
    console.log(`📥 Download request for job: ${jobId}`);
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

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// IMPORTANT: Fix the wildcard route - Use this pattern instead
// This catches all other routes and serves the SPA
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Node.js server running on port ${PORT}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`🐍 Python service: ${process.env.PYTHON_SERVICE_URL || 'http://localhost:7000'}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'public')}`);
});