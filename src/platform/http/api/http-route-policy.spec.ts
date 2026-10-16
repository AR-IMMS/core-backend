import 'reflect-metadata';
import { Reflector } from '@nestjs/core';

import {
  defineHttpRoutePolicy,
  HTTP_ROUTE_POLICY_METADATA,
  type HttpRoutePolicy,
} from './http-route-policy';
import { PublicRoute } from './public-route.decorator';

describe('HTTP route policy metadata', () => {
  /** Stores public route policy metadata on a class. */
  it('marks a class as public', () => {
    @PublicRoute()
    class PublicController {}

    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, PublicController),
    ).toEqual({ kind: 'public' });
  });

  /** Stores route policy metadata on the method handler function. */
  it('marks a method with its own route policy', () => {
    class ProtectedController {
      @defineHttpRoutePolicy({ kind: 'authenticated' })
      endpoint() {}
    }

    expect(
      Reflect.getMetadata(
        HTTP_ROUTE_POLICY_METADATA,
        getHandler(ProtectedController.prototype, 'endpoint'),
      ),
    ).toEqual({ kind: 'authenticated' });
  });

  /** Rejects multiple route policy decorators applied to the same target. */
  it('rejects duplicate policies on one target', () => {
    const addPolicy = (policy: HttpRoutePolicy) =>
      defineHttpRoutePolicy(policy);

    expect(() => {
      @PublicRoute()
      @addPolicy({ kind: 'authenticated' })
      class InvalidController {}
      return InvalidController;
    }).toThrow('Only one HTTP route policy may be applied to a target');
  });

  /** Allows a handler policy to override the controller policy. */
  it('keeps handler metadata separate from controller metadata', () => {
    @PublicRoute()
    class MixedController {
      @defineHttpRoutePolicy({
        kind: 'permissions',
        permissions: ['audit:read'],
      })
      endpoint() {}
    }

    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, MixedController),
    ).toEqual({ kind: 'public' });
    expect(
      Reflect.getMetadata(
        HTTP_ROUTE_POLICY_METADATA,
        getHandler(MixedController.prototype, 'endpoint'),
      ),
    ).toEqual({ kind: 'permissions', permissions: ['audit:read'] });
  });

  /** Applies handler-first precedence even when policy kinds differ. */
  it('resolves the handler policy before the controller policy', () => {
    @PublicRoute()
    class PublicByDefaultController {
      @defineHttpRoutePolicy({
        kind: 'permissions',
        permissions: ['audit:read'],
      })
      audit() {}
    }
    const handler = getHandler(PublicByDefaultController.prototype, 'audit');

    expect(
      new Reflector().getAllAndOverride(HTTP_ROUTE_POLICY_METADATA, [
        handler,
        PublicByDefaultController,
      ]),
    ).toEqual({ kind: 'permissions', permissions: ['audit:read'] });
  });
});

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function') throw new Error('Test handler is missing');
  return value;
}
