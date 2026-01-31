import { resizeImage } from "../services/image.service.js";
import { removeBackground } from "../services/rembg.service.js";

export const uploadAndResize = async (req, res) => {
    console.log("controller hit");
  try {
    console.log("file:", req.file);
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }
    
    const originalPath = req.file.path;
    const noBgPath = `uploads/processed/nobg-${req.file.filename}`;
    const reSizedPath = `uploads/processed/final-${req.file.filename}`;
    const outputPath = `uploads/processed/resized-${req.file.filename}`;

    // Remove background
    await removeBackground(originalPath, noBgPath);

    // Resize image

    await resizeImage(noBgPath,reSizedPath);

    res.json({
      message: "Background removed & resized successfully",
      output: reSizedPath
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Image processing failed" });
  }
};

// controllers/image.controller.js


