import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import {
  enrollmentRequestSchema,
  EnrollmentController,
} from '../enrollment.controller';
import { BootstrapTokenExpiredError } from '../../application/enrollment.port';
import { EnrollmentRecoveryExpiredError } from '../../application/enrollment.port';
import { EnrollmentRecoveryRevokedError } from '../../application/enrollment.port';

describe('EnrollmentController', () => {
  const validRequest = {
    bootstrap_token: 'arimms_bt_secret',
    enrollment_attempt_id: 'd99c38f2-7668-4814-9e70-6416014f83fe',
    installation: { id: '5baf0cba-cf5a-4d39-a3d4-e76263b70810' },
    agent: { version: '0.1.4' },
    environment: { os: 'linux', architecture: 'amd64' },
  };

  it('accepts the contract shape and rejects unexpected fields or oversized metadata', () => {
    expect(enrollmentRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(
      enrollmentRequestSchema.safeParse({
        ...validRequest,
        node_id: 'untrusted',
      }).success,
    ).toBe(false);
    expect(
      enrollmentRequestSchema.safeParse({
        ...validRequest,
        metadata: { data: 'x'.repeat(4096) },
      }).success,
    ).toBe(false);
  });

  it('marks enrollment as public bootstrap-token authentication', () => {
    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, EnrollmentController),
    ).toEqual({ kind: 'public' });
  });

  it('returns the documented response fields and disables caching', async () => {
    const useCase = {
      execute: jest.fn().mockResolvedValue({
        enrollmentId: validRequest.enrollment_attempt_id,
        installationId: validRequest.installation.id,
        binding: { id: 'binding-id', nodeId: 'node-id', status: 'active' },
        accessToken: 'credential-secret',
        controlPlane: {
          baseUrl: 'https://core.test/api/v1/agent-control',
          pollIntervalSeconds: 30,
        },
      }),
    };
    const controller = new EnrollmentController(useCase as never);
    const response = { setHeader: jest.fn(), status: jest.fn() };
    await expect(
      controller.enroll(validRequest as never, response as never),
    ).resolves.toEqual({
      enrollment_id: validRequest.enrollment_attempt_id,
      installation_id: validRequest.installation.id,
      binding: { id: 'binding-id', node_id: 'node-id', status: 'active' },
      credential: { type: 'bearer', access_token: 'credential-secret' },
      control_plane: {
        base_url: 'https://core.test/api/v1/agent-control',
        poll_interval_seconds: 30,
      },
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('returns HTTP 200 for a recovered result', async () => {
    const useCase = {
      execute: jest.fn().mockResolvedValue({
        enrollmentId: 'enrollment-id',
        installationId: validRequest.installation.id,
        binding: { id: 'binding-id', nodeId: 'node-id', status: 'active' },
        accessToken: 'credential-secret',
        controlPlane: {
          baseUrl: 'https://core.test/api/v1/agent-control',
          pollIntervalSeconds: 30,
        },
        recovered: true,
      }),
    };
    const controller = new EnrollmentController(useCase as never);
    const response = { setHeader: jest.fn(), status: jest.fn() };

    await controller.enroll(validRequest as never, response as never);

    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('maps expired recovery data to HTTP 410', async () => {
    const controller = new EnrollmentController({
      execute: jest
        .fn()
        .mockRejectedValue(new EnrollmentRecoveryExpiredError()),
    } as never);

    await expect(
      controller.enroll(
        validRequest as never,
        { setHeader: jest.fn(), status: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      status: 410,
      response: { code: 'ENROLLMENT_RECOVERY_EXPIRED' },
    });
  });

  it('maps revoked enrollment recovery to an explicit HTTP 410 code', async () => {
    const controller = new EnrollmentController({
      execute: jest
        .fn()
        .mockRejectedValue(new EnrollmentRecoveryRevokedError()),
    } as never);

    await expect(
      controller.enroll(
        validRequest as never,
        { setHeader: jest.fn(), status: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      status: 410,
      response: { code: 'ENROLLMENT_RECOVERY_REVOKED' },
    });
  });

  it('maps token expiration to a stable ProblemDetails code', async () => {
    const controller = new EnrollmentController({
      execute: jest.fn().mockRejectedValue(new BootstrapTokenExpiredError()),
    } as never);
    await expect(
      controller.enroll(
        validRequest as never,
        { setHeader: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'BOOTSTRAP_TOKEN_EXPIRED' },
    });
  });

  it('does not expose an unexpected persistence error', async () => {
    const controller = new EnrollmentController({
      execute: jest
        .fn()
        .mockRejectedValue(new Error('MongoServerError: index detail')),
    } as never);
    await expect(
      controller.enroll(
        validRequest as never,
        { setHeader: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'ENROLLMENT_UNAVAILABLE' },
    });
  });
});
