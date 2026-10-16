import 'reflect-metadata';

/** Generic route policy labels shared by HTTP modules without domain coupling. */
export type HttpRoutePolicy =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | {
      readonly kind: 'permissions';
      readonly permissions: readonly string[];
    };

/** Metadata key used by application HTTP policy guards. */
export const HTTP_ROUTE_POLICY_METADATA = 'platform:http-route-policy';

/** Writes one generic route policy on a class or route handler. */
export function defineHttpRoutePolicy(
  policy: HttpRoutePolicy,
): ClassDecorator & MethodDecorator {
  return (
    target: object,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    const descriptorValue: unknown = descriptor?.value;
    const metadataTarget =
      typeof descriptorValue === 'function' ? descriptorValue : target;
    if (Reflect.hasOwnMetadata(HTTP_ROUTE_POLICY_METADATA, metadataTarget)) {
      throw new Error('Only one HTTP route policy may be applied to a target');
    }

    Reflect.defineMetadata(HTTP_ROUTE_POLICY_METADATA, policy, metadataTarget);
  };
}
