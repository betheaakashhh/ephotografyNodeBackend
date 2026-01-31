import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import path from "path";



export const removeBackground = async (inputPath, outputPath, options ={}) => {
  const { preset = "passport", copies = 1, bgColor = "#ffffff" } = options;
  const url = "http://127.0.0.1:7000/remove-bg/";
  const formData = new FormData();
  formData.append("file", fs.createReadStream(inputPath));
  formData.append("bg_color", bgColor || "#ffffff");   // hex
  formData.append("preset", preset );   // passport | visa
  formData.append("copies", copies); 

  const response = await axios.post(
   process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:7000/remove-bg/",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
      },
      responseType: "arraybuffer",
      timeout: 120000 // 2 minutes (AI can be slow first time)
    }
  );
  

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, response.data);
  return outputPath;
};
