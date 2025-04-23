import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface JobInfo {
  id: string | number;
  data: any;
  status: string;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

@Injectable()
export class QueueUIService {
  private readonly queueNames = ['bridge', 'gelato-status', 'gelato-recovery'];
  
  constructor(
    @InjectQueue('bridge') private readonly bridgeQueue: Queue,
    @InjectQueue('gelato-status') private readonly gelatoStatusQueue: Queue,
    @InjectQueue('gelato-recovery') private readonly gelatoRecoveryQueue: Queue,
  ) {}

  private getQueueByName(name: string): Queue {
    switch (name) {
      case 'bridge':
        return this.bridgeQueue;
      case 'gelato-status':
        return this.gelatoStatusQueue;
      case 'gelato-recovery':
        return this.gelatoRecoveryQueue;
      default:
        throw new Error(`Queue ${name} not found`);
    }
  }

  async getQueuesOverview(): Promise<QueueStats[]> {
    const result: QueueStats[] = [];
    
    for (const queueName of this.queueNames) {
      const queue = this.getQueueByName(queueName);
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      
      result.push({
        name: queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
      });
    }
    
    return result;
  }

  async getQueueDetails(queueName: string): Promise<QueueStats> {
    const queue = this.getQueueByName(queueName);
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    
    return {
      name: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }

  async getJobs(queueName: string): Promise<JobInfo[]> {
    const queue = this.getQueueByName(queueName);
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(0, 10),
      queue.getFailed(0, 10),
      queue.getDelayed(),
    ]);
    
    const allJobs = [...waiting, ...active, ...completed, ...failed, ...delayed];
    
    // Sort by timestamp (newest first)
    allJobs.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit to 50 jobs
    const limitedJobs = allJobs.slice(0, 50);
    
    return limitedJobs.map(job => (<JobInfo>{
      id: job.id,
      data: job.data,
      status: this.getJobStatus(job),
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));
  }

  private getJobStatus(job: Job) {
    if (job.finishedOn && job.failedReason) return 'FAILED';
    if (job.finishedOn) return 'COMPLETED';
    if (job.processedOn) return 'ACTIVE';
    if (job.opts && job.opts.delay && job.opts.delay > 0) return 'DELAYED';
    return 'WAITING';
  }
}
