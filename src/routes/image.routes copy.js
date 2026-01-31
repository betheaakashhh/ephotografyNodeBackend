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

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${path.basename(file.originalname, path.extname(file.originalname))}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images are allowed (jpeg, jpg, png, gif)'));
    }
  }
});

// Handle file upload and process with Python service
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No image uploaded" 
      });
    }

    // Get form data from request
    const { bg_color = "#ffffff", preset = "passport", copies = 4 } = req.body;

    // Create form data for Python service
    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    formData.append("bg_color", bg_color);
    formData.append("preset", preset);
    formData.append("copies", copies.toString()); // Ensure string

    console.log(`📤 Sending to Python service: ${process.env.PYTHON_SERVICE_URL || "http://localhost:7000"}/remove-bg/`);

    // Send to Python service
    const pythonResponse = await axios.post(
      `${process.env.PYTHON_SERVICE_URL || "http://localhost:7000"}/remove-bg/`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        responseType: "arraybuffer",
        timeout: 120000
      }
    );

    // Save the processed image
    const outputFilename = `processed-${Date.now()}.jpg`;
    const outputPath = path.join(publicUploadsDir, outputFilename);

    // Save the processed image
    fs.writeFileSync(outputPath, pythonResponse.data);
    console.log(`✅ Processed image saved: ${outputPath}`);

    // Clean up original file after 30 seconds
    setTimeout(() => {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`🗑️ Cleaned up original: ${req.file.path}`);
      } catch (err) {
        console.error("Error deleting original file:", err);
      }
    }, 30000);

    // Return success with path
    res.json({
      success: true,
      message: "Background removed and photo formatted successfully",
      output: `/uploads/${outputFilename}`,
      job_id: `JOB_${Date.now()}`,
      downloadUrl: `/api/image/download?path=${encodeURIComponent(`/uploads/${outputFilename}`)}`
    });

  } catch (error) {
    console.error("❌ Image processing error:", error.message);
    
    // Clean up uploaded file if error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error("Error cleaning up failed upload:", err);
      }
    }
    
    res.status(500).json({
      success: false,
      message: "Image processing failed",
      error: error.message
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
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ 
        success: false, 
        message: "File not found" 
      });
    }

    const filename = path.basename(fullPath);
    res.download(fullPath, filename);
    
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
    const response = await axios.get(
      `${process.env.PYTHON_SERVICE_URL || "http://localhost:7000"}/jobs`
    );
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching jobs:", error.message);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch jobs", 
      error: error.message 
    });
  }
});

export default router;