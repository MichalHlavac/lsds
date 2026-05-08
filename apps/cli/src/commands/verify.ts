// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

export interface VerifyOptions {
  apiUrl: string;
  apiKey: string;
}

export interface VerifyResult {
  ready: boolean;
  status: number;
}

export async function runVerify(opts: VerifyOptions): Promise<VerifyResult> {
  const res = await fetch(`${opts.apiUrl}/health/ready`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  return { ready: res.ok, status: res.status };
}
