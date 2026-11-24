import {
  DisabledFleetInstallationPort,
  DisabledFleetInvitationPort,
} from '../disabled-fleet-ports';

describe('disabled Fleet ports', () => {
  test('keeps legacy retirement checks available when Fleet is not configured', async () => {
    const installations = new DisabledFleetInstallationPort();
    await expect(installations.findActiveByNode()).resolves.toBeNull();
  });

  test('does not accept Fleet invitation commands when the integration is disabled', async () => {
    await expect(
      new DisabledFleetInvitationPort().create(),
    ).rejects.toMatchObject({ outcomeUnknown: false });
  });

  test('reports no remote result while the Fleet endpoint is unset', async () => {
    await expect(
      new DisabledFleetInvitationPort().getByOperation(),
    ).resolves.toBeNull();
  });
});
