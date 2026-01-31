import sharp from "sharp";
import fs from "fs";
import path from "path";

/**
 * Resize to passport size (35x45mm @300 DPI)
 * ≈ 413 x 531 pixels
 */
export const resizeImage = async (inputPath, outputPath) => {
    const dir =  path.dirname(outputPath);
    if(!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    
  await sharp(inputPath)
    .resize(413, 531)
    .png({ quality: 100 })
    .toFile(outputPath);
};
