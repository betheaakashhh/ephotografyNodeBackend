// models/Job.js
import mongoose from 'mongoose';

const JobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  originalFile: {
    type: String,
    required: true
  },
  processedFile: {
    type: String
  },
  preset: {
    type: String,
    enum: ['passport', 'visa'],
    default: 'passport'
  },
  copies: {
    type: Number,
    default: 6,
    min: 1,
    max: 8
  },
  bgColor: {
    type: String,
    default: '#ffffff'
  },
  error: {
    type: String
  },
  attempts: {
    type: Number,
    default: 0
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Static methods
JobSchema.statics.createJob = async function(data) {
  const job = new this({
    jobId: data.jobId,
    originalFile: data.originalFile,
    preset: data.preset,
    copies: data.copies,
    bgColor: data.bgColor,
    status: 'pending'
  });
  
  await job.save();
  return job;
};

JobSchema.statics.updateStatus = async function(jobId, status, data = {}) {
  const update = { status, ...data };
  
  if (status === 'processing') {
    update.attempts = { $inc: 1 };
  }
  
  return await this.findOneAndUpdate(
    { jobId },
    update,
    { new: true }
  );
};

export default mongoose.model('Job', JobSchema);