import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';
import { invalidateDashboard } from './dashboard.cache.js';

/**
 * Any change made in the Dealership Portal (POST / PUT / PATCH / DELETE under /dealer/…: vehicles, inquiries, blog,
 * business details, design, content…) clears that dealership's cached Overview, so the dealer sees it at once.
 */
@Injectable()
export class DashboardInvalidator implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{ method?: string; url?: string; tenantId?: string }>();
    const method = (req?.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !String(req?.url || '').includes('/dealer/')) return next.handle();
    const clear = () => invalidateDashboard(req.tenantId);
    return next.handle().pipe(tap({ next: clear, error: clear }));
  }
}
