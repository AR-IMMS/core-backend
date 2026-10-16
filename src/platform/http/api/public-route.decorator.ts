import { defineHttpRoutePolicy } from './http-route-policy';

/** Marks an HTTP controller or handler as intentionally accessible anonymously. */
export function PublicRoute(): ClassDecorator & MethodDecorator {
  return defineHttpRoutePolicy({ kind: 'public' });
}
