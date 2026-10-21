import { ConflictException } from '@nestjs/common';
import { mapExceptionToProblemDetails } from './problem-details.mapper';

describe('mapExceptionToProblemDetails', () => {
  it('preserves a stable domain-specific code supplied by an HTTP exception', () => {
    const problem = mapExceptionToProblemDetails(
      new ConflictException({
        code: 'ROOM_LAYOUT_REVISION_CONFLICT',
        message: 'Reload the Room map and retry.',
      }),
      '/api/v1/asset-topology/rooms/room-1',
      'request-1',
      false,
    );

    expect(problem).toMatchObject({
      status: 409,
      code: 'ROOM_LAYOUT_REVISION_CONFLICT',
      detail: 'Reload the Room map and retry.',
    });
  });
});
