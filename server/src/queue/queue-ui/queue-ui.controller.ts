import { Controller, Get, Param, Render, Res } from '@nestjs/common';
import { QueueUIService } from './queue-ui.service';
import { Response } from 'express';

@Controller('queue-ui')
export class QueueUIController {
  constructor(private readonly queueUIService: QueueUIService) {}

  @Get()
  async dashboard(@Res() res: Response) {
    const queues = await this.queueUIService.getQueuesOverview();
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>BullMQ Dashboard</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .container {
              max-width: 1200px;
              margin: 0 auto;
            }
            h1 {
              color: #333;
              margin-bottom: 20px;
            }
            .queue-card {
              background-color: white;
              border-radius: 8px;
              padding: 15px;
              margin-bottom: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .queue-name {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 10px;
              color: #2c3e50;
            }
            .queue-stats {
              display: flex;
              flex-wrap: wrap;
              gap: 15px;
            }
            .stat {
              background-color: #f8f9fa;
              border-radius: 4px;
              padding: 10px;
              flex: 1;
              min-width: 120px;
              text-align: center;
            }
            .stat-value {
              font-size: 24px;
              font-weight: bold;
              color: #3498db;
              margin-bottom: 5px;
            }
            .stat-label {
              font-size: 12px;
              color: #7f8c8d;
              text-transform: uppercase;
            }
            .refresh-btn {
              background-color: #3498db;
              color: white;
              border: none;
              padding: 10px 15px;
              border-radius: 4px;
              cursor: pointer;
              margin-bottom: 20px;
            }
            .refresh-btn:hover {
              background-color: #2980b9;
            }
            .queue-details-link {
              display: inline-block;
              margin-top: 10px;
              color: #3498db;
              text-decoration: none;
            }
            .queue-details-link:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>BullMQ Dashboard</h1>
            <button class="refresh-btn" onclick="window.location.reload()">Refresh</button>
            
            ${queues.map(queue => `
              <div class="queue-card">
                <div class="queue-name">${queue.name}</div>
                <div class="queue-stats">
                  <div class="stat">
                    <div class="stat-value">${queue.waiting}</div>
                    <div class="stat-label">Waiting</div>
                  </div>
                  <div class="stat">
                    <div class="stat-value">${queue.active}</div>
                    <div class="stat-label">Active</div>
                  </div>
                  <div class="stat">
                    <div class="stat-value">${queue.completed}</div>
                    <div class="stat-label">Completed</div>
                  </div>
                  <div class="stat">
                    <div class="stat-value">${queue.failed}</div>
                    <div class="stat-label">Failed</div>
                  </div>
                  <div class="stat">
                    <div class="stat-value">${queue.delayed}</div>
                    <div class="stat-label">Delayed</div>
                  </div>
                </div>
                <a href="/queue-ui/${queue.name}" class="queue-details-link">View Details</a>
              </div>
            `).join('')}
          </div>
        </body>
      </html>
    `);
  }

  @Get(':queueName')
  async queueDetails(@Param('queueName') queueName: string, @Res() res: Response) {
    const queueDetails = await this.queueUIService.getQueueDetails(queueName);
    const jobs = await this.queueUIService.getJobs(queueName);
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${queueName} - BullMQ Dashboard</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .container {
              max-width: 1200px;
              margin: 0 auto;
            }
            h1, h2 {
              color: #333;
            }
            .back-link {
              display: inline-block;
              margin-bottom: 20px;
              color: #3498db;
              text-decoration: none;
            }
            .back-link:hover {
              text-decoration: underline;
            }
            .queue-stats {
              display: flex;
              flex-wrap: wrap;
              gap: 15px;
              margin-bottom: 30px;
            }
            .stat {
              background-color: white;
              border-radius: 8px;
              padding: 15px;
              flex: 1;
              min-width: 120px;
              text-align: center;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
              font-size: 24px;
              font-weight: bold;
              color: #3498db;
              margin-bottom: 5px;
            }
            .stat-label {
              font-size: 12px;
              color: #7f8c8d;
              text-transform: uppercase;
            }
            .jobs-table {
              width: 100%;
              border-collapse: collapse;
              background-color: white;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .jobs-table th, .jobs-table td {
              padding: 12px 15px;
              text-align: left;
              border-bottom: 1px solid #e0e0e0;
            }
            .jobs-table th {
              background-color: #f8f9fa;
              font-weight: bold;
              color: #2c3e50;
            }
            .jobs-table tr:last-child td {
              border-bottom: none;
            }
            .jobs-table tr:hover {
              background-color: #f8f9fa;
            }
            .status-waiting {
              color: #3498db;
            }
            .status-active {
              color: #2ecc71;
            }
            .status-completed {
              color: #27ae60;
            }
            .status-failed {
              color: #e74c3c;
            }
            .status-delayed {
              color: #f39c12;
            }
            .refresh-btn {
              background-color: #3498db;
              color: white;
              border: none;
              padding: 10px 15px;
              border-radius: 4px;
              cursor: pointer;
              margin-bottom: 20px;
            }
            .refresh-btn:hover {
              background-color: #2980b9;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <a href="/queue-ui" class="back-link">← Back to Dashboard</a>
            <h1>${queueName} Queue</h1>
            <button class="refresh-btn" onclick="window.location.reload()">Refresh</button>
            
            <div class="queue-stats">
              <div class="stat">
                <div class="stat-value">${queueDetails.waiting}</div>
                <div class="stat-label">Waiting</div>
              </div>
              <div class="stat">
                <div class="stat-value">${queueDetails.active}</div>
                <div class="stat-label">Active</div>
              </div>
              <div class="stat">
                <div class="stat-value">${queueDetails.completed}</div>
                <div class="stat-label">Completed</div>
              </div>
              <div class="stat">
                <div class="stat-value">${queueDetails.failed}</div>
                <div class="stat-label">Failed</div>
              </div>
              <div class="stat">
                <div class="stat-value">${queueDetails.delayed}</div>
                <div class="stat-label">Delayed</div>
              </div>
            </div>
            
            <h2>Jobs</h2>
            <table class="jobs-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th>Added</th>
                  <th>Processed</th>
                </tr>
              </thead>
              <tbody>
                ${jobs.map(job => `
                  <tr>
                    <td>${job.id}</td>
                    <td class="status-${job.status.toLowerCase()}">${job.status}</td>
                    <td>${JSON.stringify(job.data)}</td>
                    <td>${new Date(job.timestamp).toLocaleString()}</td>
                    <td>${job.processedOn ? new Date(job.processedOn).toLocaleString() : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `);
  }
}
