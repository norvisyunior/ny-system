import type { Request } from "express";
import { z } from "zod";
import type { DbHandle } from "../db";

export function handle(req: Request): DbHandle {
  return req.app.get("handle") as DbHandle;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
