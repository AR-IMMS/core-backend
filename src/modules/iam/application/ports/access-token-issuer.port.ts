/** Issues short-lived signed access tokens bound to one server session. */
export interface AccessTokenIssuerPort {
  issueAccessToken(
    this: void,
    userId: string,
    sessionId: string,
  ): Promise<string>;
}
