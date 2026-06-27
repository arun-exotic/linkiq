import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string }; correlationId?: string }>();
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? uuidv4();
    req.correlationId = correlationId;
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          this.logger.log(
            JSON.stringify({
              correlationId,
              method,
              path: url,
              statusCode: res.statusCode,
              durationMs: Date.now() - start,
              userId: req.user?.id ?? null,
            }),
          );
        },
        error: (err: { status?: number; message?: string }) => {
          this.logger.error(
            JSON.stringify({
              correlationId,
              method,
              path: url,
              statusCode: err.status ?? 500,
              durationMs: Date.now() - start,
              userId: req.user?.id ?? null,
              error: err.message,
            }),
          );
        },
      }),
    );
  }
}
