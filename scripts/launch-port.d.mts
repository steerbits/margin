import type { Server } from "node:net";
export const DEFAULT_PORT: number;
export const MAX_PORT_FALLBACKS: number;
export function parsePort(value: unknown): number;
export function portAvailable(port: number): Promise<boolean>;
export function confirmPort(question: string): Promise<boolean>;
export function selectPort(
  requested: unknown,
  options?: {
    interactive?: boolean;
    confirm?: (question: string) => Promise<boolean>;
    available?: (port: number) => Promise<boolean>;
    report?: (message: string) => void;
    action?: string;
    command?: string;
  },
): Promise<number>;
export function listenOnLoopback(server: Server, port: number): Promise<void>;
