import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ADMIN_CONFIG, type AdminConfig } from './admin.config';

/**
 * Gates the admin surface.
 *
 * Disabled answers 404 rather than 403: an endpoint that is switched off should
 * not advertise that it exists. When a token is configured it is compared with
 * constant-time equality, so the check cannot be turned into an oracle.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_CONFIG) private readonly config: AdminConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.enabled) throw new NotFoundException();
    if (!this.config.token) return true;

    const header = context.switchToHttp().getRequest<Request>().header('x-admin-token') ?? '';
    if (!timingSafeEqual(header, this.config.token)) {
      throw new UnauthorizedException('x-admin-token is missing or wrong');
    }
    return true;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
