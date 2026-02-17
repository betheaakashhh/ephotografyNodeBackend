import express from "express";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Create necessary directories
const uploadsDir = path.join(__dirname, "..", "uploads", "original");
const publicUploadsDir = path.join(__dirname, "..", "public", "uploads");

// Ensure directories exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(publicUploadsDir)) {
  fs.mkdirSync(publicUploadsDir, { recursive: true });
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Build correct URL for Python service
 */
function buildPythonUrl(endpoint) {
  const baseUrl = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_LOCAL_URL || 'http://127.0.0.1:7000';
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');
  return `${cleanBase}/${cleanEndpoint}`;
}

/**
 * Retry function for image processing
 */
async function processImageWithRetry(formData, maxRetries = 2) {
  const url = buildPythonUrl('remove-bg/');
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      console.log(`📤 Attempt ${i + 1}/${maxRetries + 1}: Sending to ${url}`);
      
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        responseType: "arraybuffer",
        timeout: 120000, // 2 minutes timeout
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      console.log(`✅ Processed successfully on attempt ${i + 1}`);
      return response;
      
    } catch (error) {
      const isLastAttempt = i === maxRetries;
      
      if (isLastAttempt) {
        console.error(`❌ All ${maxRetries + 1} attempts failed`);
        throw error;
      }
      
      // Check if it's a server error (5xx) or timeout that might be temporary
      const status = error.response?.status;
      const isServerError = status >= 500 && status < 600;
      const isTimeout = error.code === 'ECONNABORTED';
      const isConnectionRefused = error.code === 'ECONNREFUSED';
      
      if (isServerError || isTimeout || isConnectionRefused) {
        const waitTime = 2000 * Math.pow(2, i); // 2s, 4s
        console.log(`⏳ Temporary failure (${status || error.code}). Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Client error (4xx) - don't retry
        console.log(`❌ Client error (${status}) - not retrying`);
        throw error;
      }
    }
  }
}

// Configure multer for disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Increased to 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (jpeg, jpg, png, gif, webp)'));
    }
  }
});

// ==================== ROUTES ====================

// Handle file upload and process with Python service
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No image uploaded" 
      });
    }

    console.log('📸 Processing image:', {
      filename: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
      mimetype: req.file.mimetype
    });

    // Get form data from request with defaults
    const bg_color = req.body.bg_color || "#ffffff";
    const preset = req.body.preset || "passport";
    const copies = parseInt(req.body.copies) || 4;

    // Validate copies
    if (copies < 1 || copies > 12) {
      return res.status(400).json({
        success: false,
        message: "Copies must be between 1 and 12"
      });
    }

    // Create form data for Python service
    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path), {
      filename: req.file.filename,
      contentType: req.file.mimetype
    });
    formData.append("bg_color", bg_color);
    formData.append("preset", preset);
    formData.append("copies", copies.toString());

    const pythonUrl = buildPythonUrl('remove-bg/');
    console.log(`📤 Sending to Python service: ${pythonUrl}`);

    // Send to Python service with retry logic
    let pythonResponse;
    try {
      pythonResponse = await processImageWithRetry(formData);
    } catch (error) {
      // If all retries failed, check if Python service is healthy
      try {
        const healthCheck = await axios.get(buildPythonUrl('health'), { timeout: 5000 });
        console.log('✅ Python service is healthy but processing failed');
      } catch (healthError) {
        console.error('❌ Python service is unreachable');
        throw new Error('Python service is unavailable');
      }
      throw error;
    }

    // Verify we got an image response
    const contentType = pythonResponse.headers['content-type'];
    if (!contentType || !contentType.includes('image')) {
      console.error('Unexpected response type:', contentType);
      
      // Try to parse error message
      try {
        const errorText = pythonResponse.data.toString();
        console.error('Error response:', errorText);
      } catch (e) {
        // Ignore parsing error
      }
      
      throw new Error('Python service returned non-image response');
    }

    // Save the processed image
    const outputFilename = `processed-${Date.now()}.jpg`;
    const outputPath = path.join(publicUploadsDir, outputFilename);

    // Save the processed image
    fs.writeFileSync(outputPath, pythonResponse.data);
    console.log(`✅ Processed image saved: ${outputPath} (${pythonResponse.data.length} bytes)`);

    // Get job ID from response headers if available
    let jobId = `JOB_${Date.now()}`;
    const contentDisposition = pythonResponse.headers['content-disposition'];
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        jobId = match[1].replace('.jpg', '');
      }
    }

    // Schedule cleanup of original file
    setTimeout(() => {
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          console.log(`🗑️ Cleaned up original: ${req.file.path}`);
        }
      } catch (err) {
        console.error("Error deleting original file:", err);
      }
    }, 30000);

    // Schedule cleanup of processed file after 1 hour
    setTimeout(() => {
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log(`🗑️ Cleaned up processed: ${outputPath}`);
        }
      } catch (err) {
        console.error("Error deleting processed file:", err);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Return success with paths
    res.json({
      success: true,
      message: "Background removed and photo formatted successfully",
      output: `/uploads/${outputFilename}`,
      job_id: jobId,
      downloadUrl: `/api/image/download?path=${encodeURIComponent(`/uploads/${outputFilename}`)}`,
      fileSize: pythonResponse.data.length,
      contentType: contentType
    });

  } catch (error) {
    console.error("❌ Image processing error:", error.message);
    
    // Log detailed error info
    if (error.response) {
      console.error('Python service error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers
      });
    } else if (error.request) {
      console.error('No response received from Python service');
    }
    
    // Clean up uploaded file if error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`🗑️ Cleaned up failed upload: ${req.file.path}`);
      } catch (err) {
        console.error("Error cleaning up failed upload:", err);
      }
    }
    
    // Send appropriate error response
    const status = error.response?.status || 500;
    const errorMessage = error.response?.data?.toString() || error.message;
    
    res.status(status).json({
      success: false,
      message: "Image processing failed",
      error: errorMessage,
      details: {
        status: error.response?.status,
        statusText: error.response?.statusText,
        code: error.code
      }
    });
  }
});

// Download endpoint
router.get("/download", (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ 
        success: false, 
        message: "No file specified" 
      });
    }

    // Security check: prevent directory traversal
    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(__dirname, "..", "public", safePath);
    
    console.log(`📥 Download requested: ${fullPath}`);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ 
        success: false, 
        message: "File not found" 
      });
    }

    const filename = path.basename(fullPath);
    res.download(fullPath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false, 
            message: "Download failed" 
          });
        }
      }
    });
    
  } catch (error) {
    console.error("❌ Download error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Download failed", 
      error: error.message 
    });
  }
});

// Get jobs from Python service
router.get("/jobs", async (req, res) => {
  try {
    const url = buildPythonUrl('jobs');
    console.log(`📋 Fetching jobs from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 5000
    });
    
    console.log(`✅ Retrieved ${response.data?.length || 0} jobs`);
    res.json(response.data || []);
    
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch jobs", 
      error: error.message 
    });
  }
});

// Health check for image service
router.get("/health", async (req, res) => {
  try {
    const url = buildPythonUrl('health');
    const response = await axios.get(url, { timeout: 5000 });
    
    res.json({
      success: true,
      pythonService: response.data,
      message: "Image processing service is healthy"
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: "Python service unavailable",
      details: error.message
    });
  }
});

export default router;