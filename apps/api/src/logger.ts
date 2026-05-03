// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import pino from "pino";

export interface Logger {
  error(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
}

let _pino = pino({ level: process.env["LOG_LEVEL"] ?? "info" });

export const logger: Logger = {
  error(obj, msg) { _pino.error(obj, msg); },
  warn(obj, msg) { _pino.warn(obj, msg); },
  info(obj, msg) { _pino.info(obj, msg); },
};

export function setLogger(instance: pino.Logger): void {
  _pino = instance;
}
