import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import imageRoutes from './routes/image.routes.js'; 
import axios from 'axios';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());


app.use('/api/image', imageRoutes);
// Example route
app.get('/', (req, res) => {
  res.send('Hello World!');
});
app.get('/health', (req, res) => {
  res.status(200).json({ 
    
    messege: 'Service is healthy',
    status: 'OK'
 });
});



const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>{
    console.log(`Server is running on port ${PORT}`);
})
