export interface RequestContext {
  headers: Headers | null;
  request_id: string;
}

export interface WaveCredentialProvider {
  getToken(req: RequestContext): Promise<string>;
  getIdentity(req: RequestContext): Promise<string>;
}
