import { hc } from 'hono/client';
import type { Client } from './rpc-contract';

export type { InferRequestType, InferResponseType } from 'hono/client';
export type { Client } from './rpc-contract';

export const hcWithType = (...args: Parameters<typeof hc>): Client => hc(...args) as unknown as Client;
