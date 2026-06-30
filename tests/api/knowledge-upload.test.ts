import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { checkBodySize } from '../../packages/api/src/lib/validation.js';

function fakeReq(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

function mockRes() {
  let code = 200;
  const status = (n: number) => { code = n; return res; };
  const json = (body: unknown) => body;
  const res = { status, json, statusCode: code } as unknown as Response;
  return { res, getCode: () => code };
}

describe('checkBodySize middleware', () => {
  it('passes through multipart/form-data without checking content-length', () => {
    const middleware = checkBodySize(1024); // tiny limit
    const req = fakeReq({
      'content-type': 'multipart/form-data; boundary=----abc',
      'content-length': '999999999', // far exceeds limit
    });
    const { res } = mockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('rejects oversized JSON bodies', () => {
    const middleware = checkBodySize(100);
    const req = fakeReq({
      'content-type': 'application/json',
      'content-length': '9999',
    });
    let statusCode = 200;
    const res = {
      status: (n: number) => { statusCode = n; return res; },
      json: () => res,
    } as unknown as Response;
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(413);
  });

  it('allows JSON bodies within the size limit', () => {
    const middleware = checkBodySize(1024);
    const req = fakeReq({ 'content-type': 'application/json', 'content-length': '100' });
    const { res } = mockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
