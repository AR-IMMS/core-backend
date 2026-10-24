import { BadRequestException, HttpException } from '@nestjs/common';

/** Parses the strong decimal ETag used as a Room layout revision precondition. */
export function requireLayoutRevision(
  value: string | readonly string[] | undefined,
  headerName = 'If-Match',
): number {
  if (value === undefined) {
    throw new HttpException(
      {
        code: 'LAYOUT_PRECONDITION_REQUIRED',
        message: `${headerName} is required`,
      },
      428,
    );
  }

  const match =
    typeof value === 'string' ? /^"(0|[1-9]\d*)"$/.exec(value.trim()) : null;
  if (!match) {
    throw new BadRequestException({
      code: 'INVALID_LAYOUT_ETAG',
      message: `${headerName} must contain a strong quoted Room layout revision`,
    });
  }

  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) {
    throw new BadRequestException({
      code: 'INVALID_LAYOUT_ETAG',
      message: `${headerName} contains an invalid Room layout revision`,
    });
  }
  return revision;
}

export function layoutEtag(revision: number): string {
  return `"${revision}"`;
}
