import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ClicksService } from './clicks.service';

@Processor('click-events', { concurrency: 5 })
export class ClicksProcessor extends WorkerHost {
  private readonly logger = new Logger(ClicksProcessor.name);

  constructor(private readonly clicksService: ClicksService) {
    super();
  }

  async process(job: Job) {
    try {
      await this.clicksService.recordClick(
        job.data as Parameters<ClicksService['recordClick']>[0],
      );
    } catch (err) {
      this.logger.error(`Failed to process click job ${job.id}`, err);
      throw err;
    }
  }
}
