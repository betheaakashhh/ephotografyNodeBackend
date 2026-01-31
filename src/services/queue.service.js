// services/queue.service.js
import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import Job from '../models/job.js';

class QueueService {
  constructor() {
    // Initialize Redis connection
    this.redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
    };
    
    // Create main processing queue
    this.imageQueue = new Queue('image-processing', {
      redis: this.redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50, // Keep last 50 completed jobs
        removeOnFail: 100,    // Keep last 100 failed jobs
        attempts: 3,          // Retry 3 times
        backoff: {
          type: 'exponential',
          delay: 5000         // 5s, 10s, 20s
        }
      }
    });
    
    // Setup Bull Board for monitoring
    this.setupBullBoard();
    
    // Process jobs
    this.processJobs();
  }
  
  setupBullBoard() {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');
    
    createBullBoard({
      queues: [new BullAdapter(this.imageQueue)],
      serverAdapter,
    });
    
    this.serverAdapter = serverAdapter;
  }
  
  async addJob(jobData) {
    return await this.imageQueue.add('process-image', jobData, {
      jobId: jobData.jobId,
      priority: jobData.priority || 1
    });
  }
  
  processJobs() {
    this.imageQueue.process('process-image', async (job) => {
      console.log(`Processing job: ${job.id}`);
      
      const { jobId, originalFile, preset, copies, bgColor } = job.data;
      
      try {
        // Update status to processing
        await Job.updateStatus(jobId, 'processing');
        
        // Import services dynamically to avoid circular dependencies
        const { removeBackground } = await import('./rembg.service.js');
        const { resizeImage } = await import('./image.service.js');
        
        // Define paths
        const noBgPath = `uploads/processed/${jobId}-nobg.png`;
        const finalPath = `uploads/processed/${jobId}-final.jpg`;
        
        // Step 1: Remove background using Python service
        await removeBackground(originalFile, noBgPath, {
          preset,
          copies,
          bgColor
        });
        
        // Step 2: Resize if needed (your existing logic)
        await resizeImage(noBgPath, finalPath);
        
        // Update job as completed
        await Job.updateStatus(jobId, 'completed', {
          processedFile: finalPath
        });
        
        // Cleanup temporary files
        setTimeout(async () => {
          try {
            const fs = await import('fs');
            if (fs.existsSync(noBgPath)) {
              fs.unlinkSync(noBgPath);
            }
          } catch (err) {
            console.error('Cleanup error:', err);
          }
        }, 30000); // Cleanup after 30 seconds
        
        return { success: true, outputPath: finalPath };
        
      } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        
        await Job.updateStatus(jobId, 'failed', {
          error: error.message
        });
        
        throw error; // This will trigger retry logic
      }
    });
    
    // Event listeners
    this.imageQueue.on('completed', (job, result) => {
      console.log(`Job ${job.id} completed successfully`);
    });
    
    this.imageQueue.on('failed', (job, error) => {
      console.error(`Job ${job.id} failed:`, error.message);
    });
    
    this.imageQueue.on('stalled', (job) => {
      console.warn(`Job ${job.id} stalled`);
    });
  }
  
  getServerAdapter() {
    return this.serverAdapter;
  }
}

// Singleton instance
let queueInstance = null;

export const getQueueService = () => {
  if (!queueInstance) {
    queueInstance = new QueueService();
  }
  return queueInstance;
};